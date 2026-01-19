const VERSION = 'v1.3.0';
/**
 * Telegram Sync - App Plugin
 *
 * Polls Telegram Bot API for messages and routes them to appropriate collections.
 * Smart routing: one-liners → Journal, markdown → Captures, GitHub URLs → Issues, etc.
 *
 * Setup:
 * 1. Message @BotFather on Telegram: /newbot
 * 2. Copy the bot token
 * 3. In Thymer Sync Hub, find Telegram record
 * 4. Paste token into Token field
 */

class Plugin extends AppPlugin {

    async onLoad() {
        // Listen for Sync Hub ready event (handles reloads)
        this.syncHubReadyHandler = () => this.registerWithSyncHub();
        window.addEventListener('synchub-ready', this.syncHubReadyHandler);

        // Also check if Sync Hub is already ready
        if (window.syncHub) {
            this.registerWithSyncHub();
        }
    }

    onUnload() {
        if (this.syncHubReadyHandler) {
            window.removeEventListener('synchub-ready', this.syncHubReadyHandler);
        }
        if (window.syncHub) {
            window.syncHub.unregister('telegram-sync');
        }
    }

    async registerWithSyncHub() {
        await window.syncHub.register({
            id: 'telegram-sync',
            name: 'Telegram',
            icon: 'ti-plane',
            defaultInterval: '1m',
            version: VERSION,
            sync: async (ctx) => this.sync(ctx),
        });
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
            return { summary: 'Sync Hub not found', created: 0, updated: 0 };
        }

        const syncHubRecords = await syncHubCollection.getAllRecords();
        const myRecord = syncHubRecords.find(r => r.text('plugin_id') === 'telegram-sync');

        if (!myRecord) {
            debug('Telegram Sync record not found in Sync Hub');
            return { summary: 'Not configured', created: 0, updated: 0 };
        }

        // Get bot token
        const botToken = myRecord.text('token');
        if (!botToken) {
            debug('No bot token configured');
            return { summary: 'Not configured', created: 0, updated: 0 };
        }

        // Parse config for additional settings (like last_offset)
        let config = {};
        const configText = myRecord.text('config');
        if (configText) {
            try {
                config = JSON.parse(configText);
            } catch (e) {
                // Ignore invalid JSON, use empty config
            }
        }

        // Get last processed update offset
        const lastOffset = config.last_offset || 0;

        debug(`Polling Telegram (offset: ${lastOffset})...`);

        // Fetch updates from Telegram
        let updates;
        try {
            const response = await fetch(
                `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastOffset}&timeout=0`
            );
            const result = await response.json();

            if (!result.ok) {
                log(`Telegram API error: ${result.description}`);
                return { summary: `API error: ${result.description}`, created: 0, updated: 0 };
            }

            updates = result.result || [];
        } catch (e) {
            log(`Fetch error: ${e.message}`);
            return { summary: `Fetch error: ${e.message}`, created: 0, updated: 0 };
        }

        if (updates.length === 0) {
            debug('No new messages');
            return { summary: 'No new messages', created: 0, updated: 0 };
        }

        debug(`Found ${updates.length} message(s)`);

        // Process each message
        let created = 0;
        const changes = [];

        for (const update of updates) {
            const message = update.message;
            if (!message) continue;

            try {
                const result = await this.routeMessage(message, data, log, debug);
                if (result) {
                    created++;
                    changes.push(result);
                }
            } catch (e) {
                log(`Error processing message: ${e.message}`);
            }
        }

        // Update offset to mark messages as processed
        if (updates.length > 0) {
            const newOffset = updates[updates.length - 1].update_id + 1;
            config.last_offset = newOffset;
            myRecord.prop('config')?.set(JSON.stringify(config));
            debug(`Updated offset to ${newOffset}`);
        }

        return {
            summary: `${created} message(s) routed`,
            created,
            updated: 0,
            changes
        };
    }

    // =========================================================================
    // Message Routing
    // =========================================================================

    async routeMessage(message, data, log, debug) {
        const text = message.text || message.caption || '';
        const timestamp = new Date(message.date * 1000);

        debug(`Routing: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

        // Photo handling (future: store photo)
        if (message.photo) {
            return this.handlePhoto(message, data, timestamp, log, debug);
        }

        // URL detection and special handling
        if (text.trim() && this.isUrl(text.trim())) {
            const url = text.trim();

            // GitHub issue/PR URL
            if (this.isGitHubIssueUrl(url)) {
                return this.handleGitHubUrl(url, data, timestamp, log, debug);
            }

            // iCal URL
            if (this.isICalUrl(url)) {
                return this.handleICalUrl(url, data, timestamp, log, debug);
            }

            // Regular web URL - fetch and capture
            return this.handleWebUrl(url, data, timestamp, log, debug);
        }

        // Text-based routing
        return this.handleText(text, data, timestamp, log, debug);
    }

    // =========================================================================
    // URL Handlers
    // =========================================================================

    isUrl(text) {
        return /^https?:\/\/\S+$/i.test(text);
    }

    isGitHubIssueUrl(url) {
        return /github\.com\/[^\/]+\/[^\/]+\/(issues|pull)\/\d+/.test(url);
    }

    isICalUrl(url) {
        return /\.ics(\?|$)/i.test(url) || /webcal:\/\//i.test(url);
    }

    async handleGitHubUrl(url, data, timestamp, log, debug) {
        // Extract issue info from URL
        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/(issues|pull)\/(\d+)/);
        if (!match) return null;

        const [, owner, repo, type, number] = match;
        const title = `${owner}/${repo}#${number}`;

        debug(`GitHub ${type}: ${title}`);

        // For now, just add to journal with link
        // Future: actually fetch issue details and add to Issues collection
        const journal = await this.getTodayJournalRecord(data);
        if (!journal) {
            log('Could not find Journal');
            return null;
        }

        await this.appendOneLiner(journal, timestamp, `${type === 'pull' ? 'PR' : 'Issue'}: [${title}](${url})`);

        return {
            verb: 'captured',
            title: `"${title}" to`,
            guid: journal.guid,
            major: false
        };
    }

    async handleICalUrl(url, data, timestamp, log, debug) {
        debug(`iCal URL: ${url}`);

        // For now, just capture as a link
        // Future: parse iCal and add events to Calendar
        const journal = await this.getTodayJournalRecord(data);
        if (!journal) return null;

        await this.appendOneLiner(journal, timestamp, `Calendar: ${url}`);

        return {
            verb: 'captured',
            title: `"Calendar link" to`,
            guid: journal.guid,
            major: false
        };
    }

    async handleWebUrl(url, data, timestamp, log, debug) {
        debug(`Web URL: ${url}`);

        // Fetch and parse the page
        let pageInfo = { title: url, description: '', author: '', content: '' };
        try {
            pageInfo = await this.fetchPageInfo(url, debug);
        } catch (e) {
            debug(`Failed to fetch page: ${e.message}`);
        }

        // Find Captures collection (fallback to Inbox)
        const collections = await data.getAllCollections();
        let captures = collections.find(c => c.getName() === 'Captures');
        if (!captures) {
            captures = collections.find(c => c.getName() === 'Inbox');
        }

        if (!captures) {
            // Fallback: add to journal
            const journal = await this.getTodayJournalRecord(data);
            if (journal) {
                await this.appendOneLiner(journal, timestamp, `[${pageInfo.title}](${url})`);
            }
            return { verb: 'captured', title: `"${pageInfo.title.slice(0, 40)}" to`, guid: journal?.guid, major: false };
        }

        // Check if we already have this URL captured (deduplication)
        const externalId = `telegram_url_${url}`;
        const existingRecords = await captures.getAllRecords();
        const existing = existingRecords.find(r => r.text('external_id') === externalId);
        if (existing) {
            debug(`Already captured: ${url}`);
            return { verb: 'skipped', title: null, guid: existing.guid, major: false };
        }

        // Create a capture record with the page title
        const recordGuid = captures.createRecord(pageInfo.title);
        if (!recordGuid) {
            log('Failed to create capture record');
            return null;
        }

        await new Promise(resolve => setTimeout(resolve, 50));
        const records = await captures.getAllRecords();
        const record = records.find(r => r.guid === recordGuid);

        if (record) {
            // Set all the metadata fields
            record.prop('external_id')?.set(externalId);
            record.prop('source_url')?.set(url);
            record.prop('source')?.setChoice('Web');
            if (pageInfo.author) {
                record.prop('source_author')?.set(pageInfo.author);
            }

            // Set captured_at
            if (typeof DateTime !== 'undefined') {
                const dt = new DateTime(new Date());
                record.prop('captured_at')?.set(dt.value());
            }

            // Add description/content to the record body
            if (pageInfo.description || pageInfo.content) {
                const bodyContent = pageInfo.description || pageInfo.content;
                if (window.syncHub?.insertMarkdown) {
                    await window.syncHub.insertMarkdown(bodyContent, record, null);
                }
            }
        }

        // Also add reference in journal
        const journal = await this.getTodayJournalRecord(data);
        if (journal) {
            await this.addRefToJournal(journal, timestamp, 'captured', recordGuid);
        }

        return {
            verb: 'captured',
            title: null,  // ref IS the captured record
            guid: recordGuid,
            major: true
        };
    }

    /**
     * Fetch a web page and extract title, description, author, and content
     */
    async fetchPageInfo(url, debug) {
        let html;

        // Try direct fetch first
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ThymerBot/1.0)',
                }
            });
            if (response.ok) {
                html = await response.text();
                debug(`Direct fetch: ${html.length} bytes`);
            }
        } catch (e) {
            debug(`Direct fetch failed (CORS?): ${e.message}`);
        }

        // If direct fetch failed, try CORS proxy
        if (!html) {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            debug(`Trying CORS proxy...`);
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`Proxy failed: HTTP ${response.status}`);
            }
            html = await response.text();
            debug(`Proxy fetch: ${html.length} bytes`);
        }

        // Extract metadata
        const title = this.extractTitle(html) || url;
        const description = this.extractDescription(html);
        const author = this.extractAuthor(html);
        const content = this.extractContent(html);

        debug(`Title: ${title}`);
        if (description) debug(`Description: ${description.slice(0, 100)}...`);

        return { title, description, author, content };
    }

    extractTitle(html) {
        // Try og:title first
        const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
        if (ogMatch) return this.decodeHtmlEntities(ogMatch[1]);

        // Try twitter:title
        const twitterMatch = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
        if (twitterMatch) return this.decodeHtmlEntities(twitterMatch[1]);

        // Fall back to <title>
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return this.decodeHtmlEntities(titleMatch[1].trim());

        return null;
    }

    extractDescription(html) {
        // Try og:description first
        const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
        if (ogMatch) return this.decodeHtmlEntities(ogMatch[1]);

        // Try twitter:description
        const twitterMatch = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i);
        if (twitterMatch) return this.decodeHtmlEntities(twitterMatch[1]);

        // Try meta description
        const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
        if (metaMatch) return this.decodeHtmlEntities(metaMatch[1]);

        return '';
    }

    extractAuthor(html) {
        // Try article:author
        const articleMatch = html.match(/<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i);
        if (articleMatch) return this.decodeHtmlEntities(articleMatch[1]);

        // Try author meta
        const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);
        if (authorMatch) return this.decodeHtmlEntities(authorMatch[1]);

        return '';
    }

    extractContent(html) {
        // Simple extraction: try to get article or main content
        // This is a basic implementation - full readability would be better

        // Remove scripts and styles
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

        // Try to find article or main content
        const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        if (articleMatch) {
            text = articleMatch[1];
        } else {
            const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) {
                text = mainMatch[1];
            }
        }

        // Strip remaining HTML tags
        text = text.replace(/<[^>]+>/g, ' ');

        // Normalize whitespace
        text = text.replace(/\s+/g, ' ').trim();

        // Limit length
        if (text.length > 2000) {
            text = text.slice(0, 2000) + '...';
        }

        return text;
    }

    decodeHtmlEntities(str) {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    async handlePhoto(message, data, timestamp, log, debug) {
        debug('Photo message');

        // For now, add a note about the photo to journal
        // Future: download photo, store, create capture with embedded image
        const caption = message.caption || 'Photo';
        const journal = await this.getTodayJournalRecord(data);

        if (journal) {
            await this.appendOneLiner(journal, timestamp, `[Photo] ${caption}`);
        }

        return {
            verb: 'captured',
            title: `"[Photo] ${caption.slice(0, 30)}" to`,
            guid: journal?.guid,
            major: false
        };
    }

    // =========================================================================
    // Text Routing
    // =========================================================================

    async handleText(text, data, timestamp, log, debug) {
        if (!text.trim()) return null;

        const content = text.trim();
        const lines = content.split('\n').filter(l => l.trim() !== '');

        const isOneLiner = lines.length === 1;
        const isMarkdownDoc = content.startsWith('# ');

        const journal = await this.getTodayJournalRecord(data);
        if (!journal) {
            log('Could not find Journal');
            return null;
        }

        // Check if first line is a task or if any lines are tasks
        const firstLineIsTask = this.isTaskLine(lines[0]);
        const hasAnyTasks = lines.some(line => this.isTaskLine(line));

        if (isOneLiner && firstLineIsTask) {
            // Single task line
            debug('Routing: single task → Journal');
            const { text: taskText, isImportant, date } = this.parseTaskLine(lines[0]);
            
            const existingItems = await journal.getLineItems();
            const topLevelItems = existingItems.filter(item => item.parent_guid === journal.guid);
            const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;
            
            const taskItem = await journal.createLineItem(null, lastItem, 'task');
            if (taskItem) {
                const textSegments = this.parseTextSegments(taskText);
                const segments = [...textSegments];
                
                if (date) {
                    segments.push({ type: 'text', text: ' ' });
                    segments.push(this.createDateSegment(date));
                }
                
                taskItem.setSegments(segments);
                
                if (isImportant) {
                    await taskItem.setMetaProperty('done', 4);
                }
            }
            
            return {
                verb: 'added task',
                title: `"${taskText.slice(0, 40)}" to`,
                guid: journal.guid,
                major: false
            };

        } else if (isOneLiner) {
            // One-liner: simple append with timestamp
            debug('Routing: one-liner → Journal');
            await this.appendOneLiner(journal, timestamp, content);
            return {
                verb: 'noted',
                title: `"${content.slice(0, 40)}" to`,
                guid: journal.guid,
                major: false
            };

        } else if (isMarkdownDoc) {
            // Markdown document: create in Captures, add ref to Journal
            debug('Routing: markdown doc → Captures');
            const result = await this.createCapture(content, data, log);
            if (result) {
                await this.addRefToJournal(journal, timestamp, 'added', result.guid);
                return {
                    verb: 'added',
                    title: result.title,
                    guid: result.guid,
                    major: true
                };
            } else {
                // Fallback: insert in journal
                await this.insertMarkdownToJournal(content, journal, timestamp, data);
                return {
                    verb: 'noted',
                    title: `"${lines[0].slice(0, 40)}" to`,
                    guid: journal.guid,
                    major: false
                };
            }

        } else if (hasAnyTasks) {
            // Multi-line with tasks: use special handler
            debug('Routing: multi-line with tasks → Journal');
            await this.appendMultipleLines(journal, timestamp, lines);
            
            const taskCount = lines.filter(l => this.isTaskLine(l)).length;
            const verb = taskCount === 1 ? 'added task' : `added ${taskCount} tasks`;
            
            return {
                verb: verb,
                title: `to`,
                guid: journal.guid,
                major: false
            };

        } else {
            // Multi-line without tasks: regular note with bullets
            debug('Routing: multi-line note → Journal');
            await this.appendShortNote(journal, timestamp, lines, data);
            return {
                verb: 'noted',
                title: `"${lines[0].slice(0, 40)}" to`,
                guid: journal.guid,
                major: false
            };
        }
    }

    // =========================================================================
    // Task Parsing
    // =========================================================================

    /**
     * Check if a line should be a task
     */
    isTaskLine(line) {
        const trimmed = line.trim();
        return trimmed.startsWith('[]') || trimmed.toLowerCase().startsWith('task');
    }

    /**
     * Parse task text and extract metadata (text, @important flag, dates)
     */
    parseTaskLine(line) {
        let text = line.trim();
        
        // Remove [] or TASK prefix
        if (text.startsWith('[]')) {
            text = text.slice(2).trim();
        } else if (text.toLowerCase().startsWith('task')) {
            text = text.slice(4).trim();
        }

        // Check for @important and remove it
        const isImportant = text.toLowerCase().includes('@important');
        if (isImportant) {
            text = text.replace(/@important/gi, '').trim();
        }

        // Extract date and remove it from text
        const { text: cleanedText, date } = this.extractAndRemoveDate(text);

        return { text: cleanedText, isImportant, date };
    }

    // =========================================================================
    // Date Parsing
    // =========================================================================

    /**
     * Parse common date formats from text
     * Supports: @tomorrow, tomorrow, @today, today, Jan 15, 2026-01-15, 15/01, etc.
     */
    parseDate(text) {
        const now = new Date();
        const lowerText = text.toLowerCase();

        // Handle @tomorrow or tomorrow
        if (lowerText.includes('@tomorrow') || lowerText.includes('tomorrow')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
        }
        
        // Handle @today or today
        if (lowerText.includes('@today') || lowerText.includes('today')) {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }

        // Month names
        const monthNames = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
            apr: 3, april: 3, may: 4, jun: 5, june: 5,
            jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
            oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
        };

        // Try "Jan 15" or "January 15" or "@Jan 15"
        const monthDayMatch = text.match(/@?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i);
        if (monthDayMatch) {
            const month = monthNames[monthDayMatch[1].toLowerCase()];
            const day = parseInt(monthDayMatch[2]);
            let year = now.getFullYear();
            // If the date has passed this year, assume next year
            const testDate = new Date(year, month, day);
            if (testDate < now) {
                year++;
            }
            return new Date(year, month, day);
        }

        // Try ISO format: 2026-01-15
        const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        if (isoMatch) {
            const year = parseInt(isoMatch[1]);
            const month = parseInt(isoMatch[2]) - 1;
            const day = parseInt(isoMatch[3]);
            return new Date(year, month, day);
        }

        // Try DD/MM or MM/DD format (assume current year)
        const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
        if (slashMatch) {
            const first = parseInt(slashMatch[1]);
            const second = parseInt(slashMatch[2]);
            // Assume DD/MM if first > 12, otherwise MM/DD
            let month, day;
            if (first > 12) {
                day = first;
                month = second - 1;
            } else {
                month = first - 1;
                day = second;
            }
            const year = now.getFullYear();
            return new Date(year, month, day);
        }

        return null;
    }

    /**
     * Extract date from text and remove it from the text
     * @returns {Object} - {text: cleaned text, date: Date|null}
     */
    extractAndRemoveDate(text) {
        const date = this.parseDate(text);
        if (!date) {
            return { text, date: null };
        }

        let cleanedText = text;

        // Remove @tomorrow or tomorrow
        cleanedText = cleanedText.replace(/@?tomorrow\b/gi, '');
        
        // Remove @today or today
        cleanedText = cleanedText.replace(/@?today\b/gi, '');

        // Remove month + day patterns like "Jan 15" or "@Feb 28"
        cleanedText = cleanedText.replace(/@?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi, '');

        // Remove ISO dates
        cleanedText = cleanedText.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');

        // Remove slash dates
        cleanedText = cleanedText.replace(/\b\d{1,2}\/\d{1,2}\b/g, '');

        // Clean up extra spaces
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        return { text: cleanedText, date };
    }

    // =========================================================================
    // Datetime Helpers
    // =========================================================================

    /**
     * Format time as HHMMSS for Thymer datetime segments
     */
    formatTimeHHMMSS(date) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}${minutes}${seconds}`;
    }

    /**
     * Create a Thymer datetime segment for a time-only value
     */
    createTimeSegment(date) {
        // Calculate timezone offset in quarter-hours from UTC
        // JavaScript's getTimezoneOffset() returns minutes west of UTC (opposite sign)
        // Thymer expects quarter-hours east of UTC
        const offsetMinutes = -date.getTimezoneOffset();
        const offsetQuarterHours = offsetMinutes / 15;
        
        return {
            type: 'datetime',
            text: {
                d: "",  // Empty string = time only (no date)
                t: {
                    t: this.formatTimeHHMMSS(date),
                    tz: offsetQuarterHours
                }
            }
        };
    }

    /**
     * Format date as YYYYMMDD for Thymer datetime segments
     */
    formatDateYYYYMMDD(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Create a Thymer datetime segment for a date-only value
     */
    createDateSegment(date) {
        return {
            type: 'datetime',
            text: {
                d: this.formatDateYYYYMMDD(date)
                // No 't' property = date only
            }
        };
    }

    // =========================================================================
    // Text Segment Parsing (hashtags and links)
    // =========================================================================

    /**
     * Parse text into segments handling hashtags and markdown links
     */
    parseTextSegments(text) {
        const segments = [];
        let remaining = text;
        
        while (remaining.length > 0) {
            // Check for markdown link: [text](url)
            const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
            
            // Check for hashtag: #word (letters, numbers, underscores, hyphens)
            const hashtagMatch = remaining.match(/(^|[^#])#([a-zA-Z0-9_-]+)/);
            
            // Find which comes first
            let firstMatch = null;
            let firstIndex = Infinity;
            let matchType = null;
            
            if (linkMatch && linkMatch.index < firstIndex) {
                firstMatch = linkMatch;
                firstIndex = linkMatch.index;
                matchType = 'link';
            }
            
            if (hashtagMatch && hashtagMatch.index < firstIndex) {
                firstMatch = hashtagMatch;
                firstIndex = hashtagMatch.index;
                matchType = 'hashtag';
            }
            
            if (!firstMatch) {
                // No more special patterns, add remaining text
                if (remaining) {
                    segments.push({ type: 'text', text: remaining });
                }
                break;
            }
            
            if (matchType === 'link') {
                // Add text before link
                if (linkMatch.index > 0) {
                    segments.push({ type: 'text', text: remaining.slice(0, linkMatch.index) });
                }
                
                // Add link segment
                segments.push({ 
                    type: 'link', 
                    text: linkMatch[1], 
                    url: linkMatch[2] 
                });
                
                // Continue with remaining text
                remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
                
            } else if (matchType === 'hashtag') {
                // Add text before hashtag (including any prefix character)
                const beforeText = remaining.slice(0, hashtagMatch.index + hashtagMatch[1].length);
                if (beforeText) {
                    segments.push({ type: 'text', text: beforeText });
                }
                
                // Add hashtag segment with #
                segments.push({ 
                    type: 'hashtag', 
                    text: '#' + hashtagMatch[2]
                });
                
                // Continue with remaining text
                remaining = remaining.slice(hashtagMatch.index + hashtagMatch[0].length);
            }
        }
        
        return segments.length > 0 ? segments : [{ type: 'text', text: text }];
    }

    // =========================================================================
    // Journal Helpers
    // =========================================================================

    async getTodayJournalRecord(data) {
        try {
            const collections = await data.getAllCollections();
            const journalCollection = collections.find(c => c.getName() === 'Journal');
            if (!journalCollection) return null;

            const records = await journalCollection.getAllRecords();

            // Journal guids end with the date in YYYYMMDD format
            // Thymer uses previous day's journal until ~3am, so try today first, then yesterday
            const now = new Date();
            const today = now.toISOString().slice(0, 10).replace(/-/g, '');

            let journal = records.find(r => r.guid.endsWith(today));
            if (journal) return journal;

            // Fallback: try yesterday (for late-night work sessions)
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

            return records.find(r => r.guid.endsWith(yesterdayStr)) || null;
        } catch (e) {
            return null;
        }
    }

    async appendOneLiner(record, timestamp, text) {
        const existingItems = await record.getLineItems();
        const topLevelItems = existingItems.filter(item => item.parent_guid === record.guid);
        const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

        // Extract date from text if present
        const { text: cleanedText, date } = this.extractAndRemoveDate(text);

        const newItem = await record.createLineItem(null, lastItem, 'text');
        if (newItem) {
            // Create time segment and parse text for hashtags/links
            const timeSegment = this.createTimeSegment(timestamp);
            const textSegments = this.parseTextSegments(cleanedText);
            
            const segments = [timeSegment, { type: 'text', text: ' ' }, ...textSegments];
            
            // Add date segment if we found one
            if (date) {
                segments.push({ type: 'text', text: ' ' });
                segments.push(this.createDateSegment(date));
            }
            
            newItem.setSegments(segments);
        }
    }

    async appendShortNote(record, timestamp, lines, data) {
        const existingItems = await record.getLineItems();
        const topLevelItems = existingItems.filter(item => item.parent_guid === record.guid);
        const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

        // Create parent item with first line
        const parentItem = await record.createLineItem(null, lastItem, 'text');
        if (!parentItem) return;

        // Extract date from first line if present
        const { text: cleanedFirstLine, date: firstLineDate } = this.extractAndRemoveDate(lines[0]);

        const timeSegment = this.createTimeSegment(timestamp);
        const firstLineSegments = this.parseTextSegments(cleanedFirstLine);
        const parentSegments = [timeSegment, { type: 'text', text: ' ' }, ...firstLineSegments];
        
        // Add date segment if found in first line
        if (firstLineDate) {
            parentSegments.push({ type: 'text', text: ' ' });
            parentSegments.push(this.createDateSegment(firstLineDate));
        }
        
        parentItem.setSegments(parentSegments);

        // Add remaining lines as bulleted children
        let childLast = null;
        for (let i = 1; i < lines.length; i++) {
            const childItem = await record.createLineItem(parentItem, childLast, 'ulist');
            if (childItem) {
                // Extract date from child line if present
                const { text: cleanedChildLine, date: childLineDate } = this.extractAndRemoveDate(lines[i]);
                const childSegments = this.parseTextSegments(cleanedChildLine);
                const segments = [...childSegments];
                
                // Add date segment if found
                if (childLineDate) {
                    segments.push({ type: 'text', text: ' ' });
                    segments.push(this.createDateSegment(childLineDate));
                }
                
                childItem.setSegments(segments);
                childLast = childItem;
            }
        }
    }

    /**
     * Handle multiple lines that may contain tasks
     * Tasks don't get timestamps, regular lines do
     * Lines after tasks become children of those tasks
     */
    async appendMultipleLines(record, timestamp, lines) {
        const existingItems = await record.getLineItems();
        const topLevelItems = existingItems.filter(item => item.parent_guid === record.guid);
        let lastTopLevelItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;
        
        let currentTaskParent = null;
        let lastChildOfTask = null;
        
        for (const line of lines) {
            const isTask = this.isTaskLine(line);
            
            if (isTask) {
                // Create a new task (no timestamp)
                const { text: taskText, isImportant, date } = this.parseTaskLine(line);
                
                const taskItem = await record.createLineItem(null, lastTopLevelItem, 'task');
                if (taskItem) {
                    // Build segments: text, optional date, parse hashtags
                    const textSegments = this.parseTextSegments(taskText);
                    const segments = [...textSegments];
                    
                    if (date) {
                        segments.push({ type: 'text', text: ' ' });
                        segments.push(this.createDateSegment(date));
                    }
                    
                    taskItem.setSegments(segments);
                    
                    // Set important flag if needed
                    if (isImportant) {
                        await taskItem.setMetaProperty('done', 4);
                    }
                    
                    lastTopLevelItem = taskItem;
                    currentTaskParent = taskItem;
                    lastChildOfTask = null;
                }
            } else {
                // Not a task line - extract date if present
                const { text: cleanedText, date } = this.extractAndRemoveDate(line);
                
                if (currentTaskParent) {
                    // We have a task parent, add as bulleted child
                    const childItem = await record.createLineItem(currentTaskParent, lastChildOfTask, 'ulist');
                    if (childItem) {
                        const textSegments = this.parseTextSegments(cleanedText);
                        const segments = [...textSegments];
                        
                        // Add date segment if found
                        if (date) {
                            segments.push({ type: 'text', text: ' ' });
                            segments.push(this.createDateSegment(date));
                        }
                        
                        childItem.setSegments(segments);
                        lastChildOfTask = childItem;
                    }
                } else {
                    // No task parent, create as regular text with timestamp
                    const textItem = await record.createLineItem(null, lastTopLevelItem, 'text');
                    if (textItem) {
                        const timeSegment = this.createTimeSegment(timestamp);
                        const textSegments = this.parseTextSegments(cleanedText);
                        const segments = [timeSegment, { type: 'text', text: ' ' }, ...textSegments];
                        
                        // Add date segment if found
                        if (date) {
                            segments.push({ type: 'text', text: ' ' });
                            segments.push(this.createDateSegment(date));
                        }
                        
                        textItem.setSegments(segments);
                        lastTopLevelItem = textItem;
                    }
                }
            }
        }
    }

    async addRefToJournal(journalRecord, timestamp, action, guid) {
        const existingItems = await journalRecord.getLineItems();
        const topLevelItems = existingItems.filter(item => item.parent_guid === journalRecord.guid);
        const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

        const newItem = await journalRecord.createLineItem(null, lastItem, 'text');
        if (newItem) {
            const timeSegment = this.createTimeSegment(timestamp);
            newItem.setSegments([
                timeSegment,
                { type: 'text', text: ` ${action} ` },
                { type: 'ref', text: { guid: guid } }
            ]);
        }
    }

    async insertMarkdownToJournal(content, journal, timestamp, data) {
        // Use Sync Hub's markdown utilities if available
        if (window.syncHub?.insertMarkdown) {
            await window.syncHub.insertMarkdown(content, journal, null);
        } else {
            // Fallback: simple text insert
            await this.appendOneLiner(journal, timestamp, content.split('\n')[0]);
        }
    }

    // =========================================================================
    // Captures Collection
    // =========================================================================

    async createCapture(content, data, log) {
        try {
            const collections = await data.getAllCollections();
            let captures = collections.find(c => c.getName() === 'Captures');
            if (!captures) {
                captures = collections.find(c => c.getName() === 'Inbox');
            }
            if (!captures) {
                log('Captures collection not found');
                return null;
            }

            // Extract title from first heading
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

            // Create external_id from content hash for deduplication
            const externalId = `telegram_md_${this.simpleHash(content)}`;
            const existingRecords = await captures.getAllRecords();
            const existing = existingRecords.find(r => r.text('external_id') === externalId);
            if (existing) {
                // Update existing capture with new content
                const bodyContent = content.replace(/^#\s+.+\n?/, '').trim();
                if (bodyContent && window.syncHub?.replaceContents) {
                    await window.syncHub.replaceContents(bodyContent, existing);
                }
                return { guid: existing.guid, title, updated: true };
            }

            // Create the record
            const recordGuid = captures.createRecord(title);
            if (!recordGuid) {
                log('Failed to create capture record');
                return null;
            }

            await new Promise(resolve => setTimeout(resolve, 50));
            const records = await captures.getAllRecords();
            const record = records.find(r => r.guid === recordGuid);

            if (record) {
                // Set external_id and source
                record.prop('external_id')?.set(externalId);
                record.prop('source')?.setChoice('Telegram');

                // Set captured_at
                if (typeof DateTime !== 'undefined') {
                    const dt = new DateTime(new Date());
                    record.prop('captured_at')?.set(dt.value());
                }

                // Insert body content (remove title heading)
                const bodyContent = content.replace(/^#\s+.+\n?/, '').trim();
                if (bodyContent && window.syncHub?.insertMarkdown) {
                    await window.syncHub.insertMarkdown(bodyContent, record, null);
                }
            }

            return { guid: recordGuid, title };
        } catch (e) {
            log(`Error creating capture: ${e.message}`);
            return null;
        }
    }

    /**
     * Simple hash function for deduplication
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }
}
