const VERSION = 'v1.0.0';
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

        // Family ID (optional)
        const configJson = myRecord.text('config');
        let familyIdFromConfig = null;
        try {
            if (configJson) {
                const config = JSON.parse(configJson);
                familyIdFromConfig = config.family_id; // Här läser vi in ditt ID
            }
        } catch (e) {
            debug('Kunde inte läsa family_id från config');
        }

        // Token field contains refresh_token and token_endpoint
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

        if (!tokenData.refresh_token || !tokenData.token_endpoint) {
            log('Token missing refresh_token or token_endpoint');
            return { summary: 'Invalid token', created: 0, updated: 0, changes: [] };
        }

        // Get fresh access token from thymer-auth
        let accessToken;
        try {
            accessToken = await this.getAccessToken(tokenData, { log, debug });
        } catch (e) {
            log(`Token refresh failed: ${e.message}`);
            return { summary: 'Auth failed', created: 0, updated: 0, changes: [] };
        }

        // Find Calendar collection
        const calendarCollection = collections.find(c => c.getName() === 'Calendar');

        if (!calendarCollection) {
            log('Calendar collection not found');
            return { summary: 'Calendar collection not found', created: 0, updated: 0, changes: [] };
        }

        // Determine sync window
        // For incremental: sync since last_run
        // For full: sync past 7 days + future 30 days
        const now = new Date();
        let timeMin, timeMax;

        if (lastRun && !this.forceFullSync) {
            // Incremental: events updated since last run
            // But Google Calendar doesn't have 'updatedMin' for events list
            // So we fetch a rolling window and let dedup handle it
            debug(`Incremental sync since: ${lastRun.toISOString()}`);
            timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
            timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead
        } else {
            debug('Full sync');
            timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead
        }

        // Fetch events
        try {
            const events = await this.fetchEvents(accessToken, timeMin, timeMax, familyIdFromConfig, { log, debug });
            debug(`Fetched ${events.length} events`);

            const result = await this.processEvents(events, calendarCollection, data, familyIdFromConfig, { log, debug });

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

    async fetchEvents(accessToken, timeMin, timeMax, familyId, { log, debug }) {

        const calendarIds = ['primary'];

        if (familyId && familyId.trim() !== '') {
            calendarIds.push(familyId.trim());
        }

        let allEvents = [];

        for (const calId of calendarIds) {
            debug(`Fetching events for calendar: ${calId}`);
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
                // Vi sparar calId (t.ex. det långa ID:t) på varje event
                const items = (data.items || []).map(item => ({ ...item, _calendarSource: calId }));
                allEvents = allEvents.concat(items);
            } else {
                log(`Could not fetch calendar ${calId}: ${response.status}`);
            }
        }
        return allEvents;
    }

    // =========================================================================
    // Event Processing
    // =========================================================================

    async processEvents(events, calendarCollection, data, familyId, { log, debug }) {
        let created = 0;
        let updated = 0;
        const changes = [];

        const existingRecords = await calendarCollection.getAllRecords();

        for (const event of events) {
            // Skip cancelled events
            if (event.status === 'cancelled') {
                continue;
            }

            const externalId = `gcal_${event.id}`;
            const existingRecord = existingRecords.find(r => r.text('external_id') === externalId);

            // Parse event times using Thymer's DateTime class for proper range support
            const isAllDay = !!event.start?.date; // All-day events use 'date', not 'dateTime'
            const timePeriod = this.buildTimePeriod(event, isAllDay);

            // Build attendees list
            const attendees = (event.attendees || [])
                .filter(a => !a.self) // Exclude self
                .map(a => a.displayName || a.email)
                .slice(0, 5) // Limit to first 5
                .join(', ');

            // Extract Google Meet link from conferenceData
            const meetLink = event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';

            // Map Google Calendar status to our status field
            const status = event.status === 'tentative' ? 'tentative' : 'confirmed';

            const eventData = {
                external_id: externalId,
                title: event.summary || 'Untitled Event',
                source: 'google',
                calendar: event._calendarSource === 'primary' ? 'primary' : 'family',
                status: status,
                time_period: timePeriod,
                location: event.location || '',
                attendees: attendees,
                meet_link: meetLink,
                url: event.htmlLink || '',
                all_day: isAllDay ? 'Yes' : 'No',
                description: event.description || '',
                // For change detection
                updated_at: event.updated,
            };

            if (existingRecord) {
                // Check if actual content changed (not just Google's updated timestamp)
                if (this.hasContentChanged(existingRecord, eventData)) {
                    this.updateRecord(existingRecord, eventData);
                    updated++;
                    debug(`Updated: ${eventData.title}`);

                    changes.push({
                        verb: 'updated',
                        title: eventData.title,
                        guid: existingRecord.guid,
                        major: false,
                    });
                }
            } else {
                const record = await this.createRecord(calendarCollection, eventData);
                created++;
                debug(`Created: ${eventData.title}`);

                if (record) {
                    changes.push({
                        verb: 'added',
                        title: eventData.title,
                        guid: record.guid,
                        major: true, // New events are major
                    });
                }
            }
        }

        return { created, updated, changes };
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
        // Compare title
        if (existingRecord.getName() !== newData.title) return true;

        // Compare key fields
        const fieldsToCompare = ['location', 'status', 'calendar', 'attendees', 'meet_link'];
        for (const field of fieldsToCompare) {
            const current = existingRecord.text(field) || '';
            const newVal = newData[field] || '';
            if (current !== newVal) return true;
        }

        // Compare time_period (stored as Thymer DateTime range)
        const currentPeriod = existingRecord.prop('time_period');
        if (currentPeriod) {
            const currentStart = currentPeriod.date();
            const currentEnd = currentPeriod.endDate?.();

            // Compare start times
            if (currentStart && newData.start) {
                const newStart = new Date(newData.start);
                if (currentStart.getTime() !== newStart.getTime()) return true;
            }

            // Compare end times
            if (currentEnd && newData.end) {
                const newEnd = new Date(newData.end);
                if (currentEnd.getTime() !== newEnd.getTime()) return true;
            }
        }

        // No meaningful changes detected
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
