const VERSION = 'v1.0.2';
/**
 * Google Calendar Sync - App Plugin
 *
 * Syncs events from Google Calendar into the Calendar collection.
 * Uses thymer-auth worker for OAuth token refresh.
 * Uses Thymer's DateTime class for proper time range support.
 *
 * Config field (optional - has default):
 *   {"auth_url": "https://thymerhelper.lifelog.my/google?service=calendar"}
 *
 * Token field (set by OAuth flow):
 *   {"refresh_token": "...", "token_endpoint": "..."}
 */

class Plugin extends AppPlugin {

    // Default auth helper URL (shared endpoint for non-sensitive scopes)
    static DEFAULT_AUTH_URL = 'https://thymerhelper.lifelog.my/google?service=calendar';

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async onLoad() {
        // Listen for auth callback from popup
        this.messageHandler = (event) => this.handleAuthMessage(event);
        window.addEventListener('message', this.messageHandler);

        // Listen for Sync Hub ready event (handles reloads)
        this.syncHubReadyHandler = () => this.registerWithSyncHub();
        window.addEventListener('synchub-ready', this.syncHubReadyHandler);

        // Also check if Sync Hub is already ready
        if (window.syncHub) {
            this.registerWithSyncHub();
        }
    }

    onUnload() {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
        }
        if (this.syncHubReadyHandler) {
            window.removeEventListener('synchub-ready', this.syncHubReadyHandler);
        }
        if (window.syncHub) {
            window.syncHub.unregister('google-calendar-sync');
        }
    }

    // =========================================================================
    // OAuth Connect Flow
    // =========================================================================

    async startConnect() {
        // Get auth_url from config or use default
        const authUrl = await this.getAuthUrl();

        // Open auth in popup
        const width = 500;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        window.open(
            authUrl,
            'thymer-auth',
            `width=${width},height=${height},left=${left},top=${top}`
        );
    }

    async getAuthUrl() {
        try {
            const collections = await this.data.getAllCollections();
            const syncHubCollection = collections.find(c => c.getName() === 'Sync Hub');
            if (!syncHubCollection) return Plugin.DEFAULT_AUTH_URL;

            const records = await syncHubCollection.getAllRecords();
            const myRecord = records.find(r => r.text('plugin_id') === 'google-calendar-sync');
            if (!myRecord) return Plugin.DEFAULT_AUTH_URL;

            const configJson = myRecord.text('config');
            if (!configJson) return Plugin.DEFAULT_AUTH_URL;

            const config = JSON.parse(configJson);
            return config.auth_url || Plugin.DEFAULT_AUTH_URL;
        } catch (e) {
            return Plugin.DEFAULT_AUTH_URL;
        }
    }

    async handleAuthMessage(event) {
        // Validate message
        if (!event.data || event.data.type !== 'thymer-auth') {
            return;
        }

        if (event.data.service !== 'calendar') {
            return; // Not for us
        }

        const config = event.data.config;
        if (!config || !config.refresh_token || !config.token_endpoint) {
            console.error('[Google Calendar] Invalid config received');
            return;
        }

        // Save token to Sync Hub record
        try {
            await this.saveToken(config);
            console.log('[Google Calendar] Token saved successfully');

            // Trigger initial full sync
            if (window.syncHub) {
                window.syncHub.requestSync('google-calendar-sync', { full: true, manual: true });
            }
        } catch (e) {
            console.error('[Google Calendar] Failed to save token:', e);
        }
    }

    async saveToken(tokenData) {
        const collections = await this.data.getAllCollections();
        const syncHubCollection = collections.find(c => c.getName() === 'Sync Hub');

        if (!syncHubCollection) {
            throw new Error('Sync Hub collection not found');
        }

        const records = await syncHubCollection.getAllRecords();
        let myRecord = records.find(r => r.text('plugin_id') === 'google-calendar-sync');

        if (!myRecord) {
            // Create record if it doesn't exist
            const recordGuid = syncHubCollection.createRecord('Google Calendar');
            await new Promise(resolve => setTimeout(resolve, 100));

            const updatedRecords = await syncHubCollection.getAllRecords();
            myRecord = updatedRecords.find(r => r.guid === recordGuid);

            if (myRecord) {
                const pluginIdProp = myRecord.prop('plugin_id');
                if (pluginIdProp) pluginIdProp.set('google-calendar-sync');
            }
        }

        if (!myRecord) {
            throw new Error('Could not find or create Sync Hub record');
        }

        // Save token data to token field
        const tokenProp = myRecord.prop('token');
        if (tokenProp) {
            tokenProp.set(JSON.stringify(tokenData));
        }

        // Enable the plugin
        const enabledProp = myRecord.prop('enabled');
        if (enabledProp) {
            enabledProp.set(true);
        }
    }


    async registerWithSyncHub() {
        console.log('[Google Calendar] Registering with Sync Hub...');
        await window.syncHub.register({
            id: 'google-calendar-sync',
            name: 'Google Calendar',
            icon: 'ti-calendar',
            defaultInterval: '15m',
            version: VERSION,
            sync: async (ctx) => this.sync(ctx),
        });
        // Register connect function for dashboard button
        window.syncHub.registerConnect('google-calendar-sync', () => this.startConnect());
        console.log('[Google Calendar] Registered successfully');
    }

    // =========================================================================
    // Sync Logic
    // =========================================================================

    async sync({ data, ui, log, debug }) {
        // Get config from Sync Hub record
        const collections = await data.getAllCollections();
        const syncHubCollection = collections.find(c => c.getName() === 'Sync Hub');

        if (!syncHubCollection) {
            log('Sync Hub collection not found');
            return { summary: 'Sync Hub not found', created: 0, updated: 0, changes: [] };
        }

        const syncHubRecords = await syncHubCollection.getAllRecords();
        const myRecord = syncHubRecords.find(r => r.text('plugin_id') === 'google-calendar-sync');

        if (!myRecord) {
            debug('Google Calendar record not found in Sync Hub');
            return { summary: 'Not configured', created: 0, updated: 0, changes: [] };
        }

        const configJson = myRecord.text('config');
        let calendarsMapping = { 'primary': 'Primary' };
        try {
            if (configJson) {
                const config = JSON.parse(configJson);
                if (config.calendars && typeof config.calendars === 'object') {
                    calendarsMapping = { ...calendarsMapping, ...config.calendars };
                }
            }
        } catch (e) {
            debug('Could not parse config JSON');
        }

        const tokenJson = myRecord.text('token');
        const lastRun = myRecord.prop('last_run')?.date();

        if (!tokenJson) {
            debug('No token - use "Connect Google Calendar" command');
            return { summary: 'Not connected', created: 0, updated: 0, changes: [] };
        }

        let tokenData;
        try {
            tokenData = JSON.parse(tokenJson);
        } catch (e) {
            log('Invalid token JSON');
            return { summary: 'Invalid token', created: 0, updated: 0, changes: [] };
        }

        let accessToken;
        try {
            accessToken = await this.getAccessToken(tokenData, { log, debug });
        } catch (e) {
            log(`Token refresh failed: ${e.message}`);
            return { summary: 'Auth failed', created: 0, updated: 0, changes: [] };
        }

        const calendarCollection = collections.find(c => c.getName() === 'Calendar');
        if (!calendarCollection) {
            log('Calendar collection not found');
            return { summary: 'Calendar collection not found', created: 0, updated: 0, changes: [] };
        }

        const now = new Date();
        let timeMin, timeMax;

        // DEFINIERA OM DET ÄR EN FULL SYNC
        const isFullSync = !lastRun || this.forceFullSync;

        if (!isFullSync) {
            debug(`Incremental sync since: ${lastRun.toISOString()}`);
            timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        } else {
            debug('Full sync');
            timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        }

        try {
            const events = await this.fetchEvents(accessToken, timeMin, timeMax, calendarsMapping, { log, debug });
            debug(`Fetched ${events.length} events`);

            // SKICKA MED isFullSync HÄR
            const result = await this.processEvents(events, calendarCollection, data, calendarsMapping, {
                log,
                debug,
                isFullSync
            });

            const summary = result.created > 0 || result.updated > 0
                ? `${result.created} new, ${result.updated} updated`
                : 'No changes';

            return {
                summary,
                created: result.created,
                updated: result.updated,
                changes: result.changes,
            };
        } catch (e) {
            log(`Fetch failed: ${e.message}`);
            return { summary: 'Fetch failed', created: 0, updated: 0, changes: [] };
        }
    }

    // =========================================================================
    // OAuth Token Refresh
    // =========================================================================

    async getAccessToken(config, { log, debug }) {
        debug('Refreshing access token...');

        const response = await fetch(config.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: config.refresh_token }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
        }

        const tokens = await response.json();

        if (tokens.error) {
            throw new Error(tokens.error_description || tokens.error);
        }

        if (!tokens.access_token) {
            throw new Error('No access_token in response');
        }

        debug('Access token refreshed');
        return tokens.access_token;
    }

    // =========================================================================
    // Google Calendar API
    // =========================================================================

    async fetchEvents(accessToken, timeMin, timeMax, calendarsMapping, { log, debug }) {
        const calendarIds = Object.keys(calendarsMapping);
        let allEvents = [];

        for (const calId of calendarIds) {
            const calLabel = calendarsMapping[calId];
            debug(`Fetching events for calendar: ${calLabel} (${calId})`);

            const params = new URLSearchParams({
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '250',
            });

            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });

            if (response.ok) {
                const data = await response.json();
                // Tag each event with its calendar source ID and label
                const items = (data.items || []).map(item => ({
                    ...item,
                    _calendarId: calId,
                    _calendarLabel: calLabel,
                }));
                allEvents = allEvents.concat(items);
            } else {
                log(`Could not fetch calendar ${calLabel}: ${response.status}`);
            }
        }
        return allEvents;
    }

    // =========================================================================
    // Event Processing
    // =========================================================================

    async processEvents(events, calendarCollection, data, calendarsMapping, { log, debug, isFullSync }) {
        let created = 0;
        let updated = 0;
        const changes = [];
        const recurringGroups = new Map();

        const existingRecords = await calendarCollection.getAllRecords();

                const fetchedExternalIds = new Set(events.map(event => `gcal_${event.id}`));

        for (const event of events) {
            if (event.status === 'cancelled') continue;

            const externalId = `gcal_${event.id}`;
            const existingRecord = existingRecords.find(r => r.text('external_id') === externalId);
            const isRecurring = !!event.recurringEventId;

            const isAllDay = !!event.start?.date;
            const timePeriod = this.buildTimePeriod(event, isAllDay);

            const attendees = (event.attendees || [])
                .filter(a => !a.self)
                .map(a => a.displayName || a.email)
                .slice(0, 5)
                .join(', ');

            const meetLink = event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';
            const status = event.status === 'tentative' ? 'tentative' : 'confirmed';

            const eventData = {
                external_id: externalId,
                title: event.summary || 'Untitled Event',
                source: 'google',
                calendar: event._calendarLabel || 'Primary',
                status: status,
                time_period: timePeriod,
                location: event.location || '',
                attendees: attendees,
                meet_link: meetLink,
                url: event.htmlLink || '',
                all_day: isAllDay ? 'Yes' : 'No',
                description: event.description || '',
                updated_at: event.updated,
                
                start: event.start?.dateTime || event.start?.date,
                end: event.end?.dateTime || event.end?.date
            };

            if (existingRecord) {
                if (this.hasContentChanged(existingRecord, eventData)) {
                    
                    this.setField(existingRecord, 'title', eventData.title);
                    this.updateRecord(existingRecord, eventData);
                    updated++;
                    debug(`Updated: ${eventData.title}`);

                    if (isRecurring) {
                        this.trackRecurringChange(recurringGroups, event, 'updated', existingRecord.guid);
                    } else {
                        changes.push({
                            verb: 'updated',
                            title: eventData.title,
                            guid: existingRecord.guid,
                            major: false,
                        });
                    }
                }
            } else {
                const record = await this.createRecord(calendarCollection, eventData);
                created++;
                debug(`Created: ${eventData.title}`);

                if (record) {
                    if (isRecurring) {
                        this.trackRecurringChange(recurringGroups, event, 'added', record.guid);
                    } else {
                        changes.push({
                            verb: 'added',
                            title: eventData.title,
                            guid: record.guid,
                            major: true,
                        });
                    }
                }
            }
        }

        
        if (isFullSync) {
            debug("Full sync: Checking for events removed from Google Calendar...");

            for (const record of existingRecords) {
                const extId = record.text('external_id');

                if (extId && extId.startsWith('gcal_') && !fetchedExternalIds.has(extId)) {
                    const currentTitle = record.text('title') || (record.getName ? record.getName() : '');

                    
                    if (currentTitle && !currentTitle.startsWith('[REMOVED]')) {
                        const newTitle = `[REMOVED] ${currentTitle}`;

                        this.setField(record, 'title', newTitle);
                        this.setField(record, 'status', 'cancelled');

                        updated++;
                        debug(`Marked as removed: ${currentTitle}`);

                        changes.push({
                            verb: 'updated', 
                            title: newTitle,
                            guid: record.guid,
                            major: false,
                        });
                    }
                }
            }
        }
                
        for (const [recurringId, group] of recurringGroups) {
            const countText = group.count > 1 ? `${group.count} instances of ` : '';
            changes.push({
                verb: group.verb,
                title: `${countText}${group.title}`,
                guid: group.firstGuid,
                major: group.verb === 'added',
                isRecurring: true,
                count: group.count,
            });
        }

        return { created, updated, changes };
    }

    /**
     * Track recurring event instances for collapsed journal entries
     */
    trackRecurringChange(groups, event, verb, guid) {
        const recurringId = event.recurringEventId;
        if (!groups.has(recurringId)) {
            groups.set(recurringId, {
                title: event.summary || 'Untitled Event',
                verb: verb,
                firstGuid: guid,
                count: 0,
            });
        }
        const group = groups.get(recurringId);
        group.count++;
        // If any instance is 'added', the whole group is 'added'
        if (verb === 'added') {
            group.verb = 'added';
        }
    }

    /**
     * Build a DateTime value with proper range support.
     * Uses Thymer's DateTime class for time ranges.
     */
    buildTimePeriod(event, isAllDay) {
        let startDate, endDate;

        if (isAllDay) {
            startDate = new Date(event.start.date);
            endDate = event.end?.date ? new Date(event.end.date) : startDate;
        } else {
            startDate = new Date(event.start.dateTime);
            endDate = event.end?.dateTime ? new Date(event.end.dateTime) : startDate;
        }

        // Check if DateTime class is available (Thymer global)
        if (typeof DateTime === 'undefined') {
            // Fallback to plain Date if DateTime not available
            return startDate;
        }

        const startDt = new DateTime(startDate);

        // For all-day events, strip the time component
        if (isAllDay) {
            startDt.setTime(null);
        }

        // If we have an end time, create a range
        if (endDate && endDate.getTime() !== startDate.getTime()) {
            if (isAllDay) {
                // Google Calendar uses exclusive end dates for all-day events
                // Dec 27 all-day → start=Dec 27, end=Dec 28 (exclusive)
                // Subtract 1 day to make it inclusive
                endDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

                // If start == adjusted end, it's a single day - no range needed
                if (startDate.toDateString() !== endDate.toDateString()) {
                    // Multi-day all-day event
                    const endDt = new DateTime(endDate);
                    endDt.setTime(null);
                    startDt.setRangeTo(endDt);
                }
            } else {
                // Regular timed event - create range with both times
                const endDt = new DateTime(endDate);
                startDt.setRangeTo(endDt);
            }
        }

        return startDt.value();
    }

    // =========================================================================
    // Record Management
    // =========================================================================

    async createRecord(collection, eventData) {
        const recordGuid = collection.createRecord(eventData.title);
        if (!recordGuid) return null;

        await new Promise(resolve => setTimeout(resolve, 50));
        const records = await collection.getAllRecords();
        const record = records.find(r => r.guid === recordGuid);

        if (!record) {
            return null;
        }

        this.setRecordFields(record, eventData);

        // Add event description as markdown content
        if (eventData.description && window.syncHub?.insertMarkdown) {
            await window.syncHub.insertMarkdown(eventData.description, record, null);
        }

        return record;
    }

    updateRecord(record, eventData) {
        this.setRecordFields(record, eventData);

        // Update description via SyncHub
        if (eventData.description && window.syncHub?.replaceContents) {
            window.syncHub.replaceContents(eventData.description, record);
        }
    }

    setRecordFields(record, data) {
        this.setField(record, 'external_id', data.external_id);
        this.setField(record, 'source', data.source);
        this.setField(record, 'calendar', data.calendar);
        this.setField(record, 'status', data.status);
        this.setField(record, 'time_period', data.time_period);
        this.setField(record, 'location', data.location);
        this.setField(record, 'attendees', data.attendees);
        this.setField(record, 'meet_link', data.meet_link);
        this.setField(record, 'url', data.url);
        this.setField(record, 'all_day', data.all_day);
        this.setField(record, 'updated_at', data.updated_at);
    }

    /**
     * Compare actual event content to detect real changes.
     * More reliable than comparing Google's updated timestamp.
     */
    hasContentChanged(existingRecord, newData) {
        // 1. Jämför titel (Viktigt!)
        const currentTitle = existingRecord.text('title') || (existingRecord.getName ? existingRecord.getName() : '');
        if (currentTitle !== newData.title) return true;

        // 2. Jämför enkla textfält
        const fieldsToCompare = ['location', 'status', 'description', 'calendar', 'all_day'];
        for (const field of fieldsToCompare) {
            const current = existingRecord.text(field);
            const newVal = newData[field];
            if (current !== newVal) return true;
        }

        // 3. Jämför tid (time_period)
        const currentPeriod = existingRecord.prop('time_period');
        if (currentPeriod) {
            const currentStart = currentPeriod.date();
            const currentEnd = currentPeriod.endDate?.();

            if (currentStart && newData.start) {
                const newStart = new Date(newData.start);
                if (currentStart.getTime() !== newStart.getTime()) return true;
            }

            if (currentEnd && newData.end) {
                const newEnd = new Date(newData.end);
                if (currentEnd.getTime() !== newEnd.getTime()) return true;
            }
        }

        return false;
    }

    setField(record, fieldId, value) {
        try {
            const prop = record.prop(fieldId);
            if (!prop) return;

            if (typeof value === 'string') {
                if (typeof prop.setChoice === 'function') {
                    const success = prop.setChoice(value);
                    if (!success) {
                        prop.set(value);
                    }
                } else {
                    prop.set(value);
                }
            } else {
                prop.set(value);
            }
        } catch (e) {
            // Field doesn't exist or can't be set
        }
    }
}
