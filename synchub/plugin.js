/**
 * Sync Hub - Plugin Orchestrator
 *
 * Exposes window.syncHub API for self-syncing collections to register.
 * Manages scheduling, status tracking, and activity logging.
 *
 * Architecture: Collections All The Way Down
 * - Each plugin has one record in this collection (singleton)
 * - Record contains: settings + status + activity log (in body)
 * - State stored in Thymer, not IndexedDB
 */

// Markdown config
const BLANK_LINE_BEFORE_HEADINGS = true;

// Dashboard CSS
const DASHBOARD_CSS = `
    .sync-dashboard {
        padding: 24px;
        font-family: var(--font-family);
    }
    .sync-dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }
    .sync-card {
        background: var(--bg-hover);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 20px;
        transition: all 0.2s ease;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .sync-card:hover {
        background: var(--bg-active, var(--bg-hover));
        border-color: rgba(255,255,255,0.2);
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        transform: translateY(-2px);
    }
    .sync-card[data-status="error"] {
        border-color: var(--enum-red-bg);
    }
    .sync-card[data-status="syncing"] {
        border-color: var(--enum-blue-bg);
    }
    .sync-card[data-enabled="no"] {
        opacity: 0.6;
        border-style: dashed;
    }
    .sync-card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
    }
    .sync-card-icon {
        font-size: 20px;
        color: var(--text-muted);
    }
    .sync-card-name {
        font-weight: 600;
        font-size: 14px;
        color: var(--text-default);
        flex: 1;
    }
    .sync-card-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--enum-green-bg);
    }
    .sync-card-dot.error {
        background: var(--enum-red-bg);
    }
    .sync-card-dot.stale {
        background: var(--enum-orange-bg);
    }
    .sync-card-dot.disabled {
        background: var(--text-muted);
    }
    .sync-card-dot.syncing {
        background: none;
        width: auto;
        height: auto;
    }
    .sync-card-dot.syncing .ti-blinking-dot {
        color: var(--enum-blue-fg);
        font-size: 20px;
    }
    .sync-card-body {
        text-align: center;
        padding: 8px 0;
    }
    .sync-card-value {
        font-size: 36px;
        font-weight: 700;
        color: var(--text-default);
        line-height: 1;
        margin-bottom: 4px;
    }
    .sync-card-label {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .sync-card-footer {
        text-align: center;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-default);
    }
    .sync-card-time {
        font-size: 12px;
        color: var(--text-muted);
    }
    .sync-card-error {
        font-size: 11px;
        color: var(--enum-red-fg);
        margin-top: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .sync-dashboard-summary {
        background: var(--bg-default);
        border: 1px solid var(--border-default);
        border-radius: 12px;
        padding: 16px 24px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 24px;
        color: var(--text-muted);
        font-size: 14px;
    }
    .sync-summary-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .sync-summary-value {
        font-weight: 600;
        color: var(--text-default);
    }
    .sync-summary-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }
    .sync-summary-dot.healthy { background: var(--enum-green-bg); }
    .sync-summary-dot.warning { background: var(--enum-orange-bg); }
    .sync-summary-dot.error { background: var(--enum-red-bg); }
    .sync-summary-dot.desktop-connected { background: var(--enum-blue-bg); }
    .sync-summary-dot.desktop-disconnected { background: var(--text-muted); opacity: 0.5; }
    .sync-summary-item.desktop-status { margin-left: auto; }
    .sync-dashboard-empty {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
    }
    .sync-dashboard-empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }
    .sync-dashboard-empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-default);
        margin-bottom: 8px;
    }
    /* Action buttons row */
    .sync-card-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-default);
    }
    .sync-card-btn {
        flex: 1;
        padding: 6px 12px;
        border: 1px solid var(--border-default);
        border-radius: 6px;
        background: var(--bg-default);
        color: var(--text-default);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }
    .sync-card-btn:hover {
        background: var(--bg-hover);
        border-color: var(--text-muted);
    }
    .sync-card-btn:active {
        transform: scale(0.97);
    }
    .sync-card-btn.primary {
        background: var(--enum-green-bg);
        border-color: var(--enum-green-bg);
        color: white;
    }
    .sync-card-btn.primary:hover {
        filter: brightness(1.1);
    }
    .sync-card-btn.connect {
        background: var(--enum-blue-bg);
        border-color: var(--enum-blue-bg);
        color: white;
    }
    .sync-card-btn.connect:hover {
        filter: brightness(1.1);
    }
    .sync-card-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

class Plugin extends CollectionPlugin {

    async onLoad() {
        // Find our collection
        const collections = await this.data.getAllCollections();
        this.myCollection = collections.find(c => c.getName() === this.getName());

        if (!this.myCollection) {
            this.log('Could not find own collection!', 'error');
            return;
        }

        // Expose API for other collections to register
        window.syncHub = {
            register: (config) => this.registerPlugin(config),
            unregister: (pluginId) => this.unregisterPlugin(pluginId),
            requestSync: (pluginId, options) => this.requestSync(pluginId, options),
            registerConnect: (pluginId, connectFn) => this.registerConnect(pluginId, connectFn),
            getStatus: (pluginId) => this.getPluginStatus(pluginId),
            // Markdown utilities
            insertMarkdown: (markdown, record, afterItem) => this.insertMarkdown(markdown, record, afterItem),
            replaceContents: (markdown, record) => this.replaceContents(markdown, record),
            parseLine: (line) => this.parseLine(line),
            parseInlineFormatting: (text) => this.parseInlineFormatting(text),
            // DateTime & formatting utilities
            setLastRun: (record) => this.setLastRun(record),
            formatTimestamp: () => this.formatTimestamp(),
            formatRelativeTime: (date) => this.formatRelativeTime(date),
            // Journal integration
            getTodayJournal: () => this.getTodayJournalRecord(),
            logToJournal: (changes, level) => this.writeChangesToJournal(changes, level),
            // Agent tools - collections register semantic operations
            registerCollectionTools: (config) => this.registerCollectionTools(config),
            getRegisteredTools: () => this.getRegisteredTools(),
            executeToolCall: (name, args) => this.executeToolCall(name, args),
        };

        // Track registered sync functions (MUST be before event dispatch!)
        this.syncFunctions = new Map();

        // Track registered connect functions for OAuth plugins
        this.connectFunctions = new Map();

        // Track registered collection tools for agents
        this.collectionTools = new Map();

        // Dispatch event so plugins can (re)register
        console.log('[SyncHub] Ready, dispatching synchub-ready event');
        window.dispatchEvent(new CustomEvent('synchub-ready'));

        // Track currently syncing plugin for status bar
        this.currentlySyncing = null;

        // Status bar item for sync status
        this.statusBarItem = this.ui.addStatusBarItem({
            htmlLabel: this.buildStatusLabel('idle'),
            tooltip: 'Sync Hub - Initializing...',
            onClick: () => this.onStatusBarClick()
        });

        // MCP status bar item
        this.mcpConnectedAt = null;
        this.mcpActivityLog = []; // Track recent MCP calls
        this.mcpStatusBarItem = this.ui.addStatusBarItem({
            htmlLabel: this.buildMcpLabel(false),
            tooltip: 'MCP disconnected - Click to connect',
            onClick: () => this.onMcpStatusBarClick()
        });

        // Command palette: Paste Markdown
        this.pasteCommand = this.ui.addCommandPaletteCommand({
            label: 'Paste Markdown',
            icon: 'clipboard-text',
            onSelected: () => this.pasteMarkdownFromClipboard()
        });

        // Command palette: Sync All
        this.syncAllCommand = this.ui.addCommandPaletteCommand({
            label: 'Sync Hub: Sync All',
            icon: 'refresh',
            onSelected: () => this.syncAll()
        });

        // Command palette: Reset Stuck Syncs
        this.resetCommand = this.ui.addCommandPaletteCommand({
            label: 'Sync Hub: Reset Stuck Syncs',
            icon: 'refresh-alert',
            onSelected: () => this.resetStuckSyncs()
        });

        // Register Dashboard view
        this.registerDashboardView();

        // Start the scheduler
        this.startScheduler();

        // Initial status update
        setTimeout(() => this.updateStatusBar(), 500);

        // Periodic status bar refresh (every 30s to update relative times)
        this.statusBarRefreshInterval = setInterval(() => this.updateStatusBar(), 30000);

        // Connect to Thymer Desktop (if running)
        this.connectToDesktop();
    }

    onUnload() {
        // Disconnect from desktop
        this.disconnectFromDesktop();
        if (this.pasteCommand) {
            this.pasteCommand.remove();
        }
        if (this.syncAllCommand) {
            this.syncAllCommand.remove();
        }
        if (this.resetCommand) {
            this.resetCommand.remove();
        }
        if (this.statusBarItem) {
            this.statusBarItem.remove();
        }
        if (this.mcpStatusBarItem) {
            this.mcpStatusBarItem.remove();
        }
        if (this.statusBarRefreshInterval) {
            clearInterval(this.statusBarRefreshInterval);
        }
        this.stopScheduler();
        delete window.syncHub;
    }

    /**
     * Register the Dashboard custom view for Grafana-style singlestats
     */
    registerDashboardView() {
        this.ui.injectCSS(DASHBOARD_CSS);

        this.views.register("Dashboard", (viewContext) => {
            const element = viewContext.getElement();
            let records = [];
            let container = null;

            /**
             * Get health status for a plugin record
             * @param {Object} record - Plugin record
             * @returns {{dotClass: string, timeText: string, isHealthy: boolean}}
             */
            const getHealthStatus = (record) => {
                const enabled = record.prop('enabled')?.choice();
                const status = record.prop('status')?.choice();
                const lastRun = record.prop('last_run')?.date();
                const lastError = record.prop('last_error')?.text();

                if (enabled === 'no') {
                    return { dotClass: 'disabled', timeText: 'Disabled', isHealthy: true };
                }

                if (status === 'syncing') {
                    return { dotClass: 'syncing', timeText: 'Syncing...', isHealthy: true };
                }

                if (status === 'error') {
                    const errorText = lastError ? lastError.substring(0, 50) : 'Unknown error';
                    return { dotClass: 'error', timeText: errorText, isHealthy: false };
                }

                if (!lastRun) {
                    return { dotClass: 'stale', timeText: 'Never synced', isHealthy: false };
                }

                const now = new Date();
                const lastRunDate = new Date(lastRun);
                const hoursSince = (now - lastRunDate) / (1000 * 60 * 60);

                if (hoursSince > 24) {
                    return {
                        dotClass: 'stale',
                        timeText: this.formatRelativeTime(lastRunDate),
                        isHealthy: false
                    };
                }

                return {
                    dotClass: '',
                    timeText: this.formatRelativeTime(lastRunDate),
                    isHealthy: true
                };
            };

            /**
             * Render the dashboard
             */
            const renderDashboard = () => {
                if (!container) return;
                container.innerHTML = '';

                // Filter to plugin records (have plugin_id)
                const plugins = records.filter(r => r.prop('plugin_id')?.text());

                if (plugins.length === 0) {
                    container.innerHTML = `
                        <div class="sync-dashboard-empty">
                            <div class="sync-dashboard-empty-icon">📡</div>
                            <div class="sync-dashboard-empty-title">No Sync Plugins</div>
                            <div>Install a sync plugin to see it here</div>
                        </div>
                    `;
                    return;
                }

                // Create card grid
                const grid = document.createElement('div');
                grid.className = 'sync-dashboard-grid';

                let healthyCount = 0;
                let errorCount = 0;
                let enabledCount = 0;

                plugins.forEach(record => {
                    const pluginId = record.prop('plugin_id')?.text() || 'unknown';
                    const pluginName = record.getName() || pluginId;
                    const enabled = record.prop('enabled')?.choice();
                    const status = record.prop('status')?.choice() || 'idle';
                    const interval = record.prop('interval')?.text() || 'manual';
                    const health = getHealthStatus(record);

                    // Get icon from registered sync function if available
                    const syncFunc = this.syncFunctions.get(pluginId);
                    const icon = syncFunc?.icon || 'refresh';

                    if (enabled === 'yes') {
                        enabledCount++;
                        if (health.isHealthy) healthyCount++;
                        else errorCount++;
                    }

                    const card = document.createElement('div');
                    card.className = 'sync-card';
                    card.setAttribute('data-status', status);
                    card.setAttribute('data-enabled', enabled || 'no');

                    const dotContent = health.dotClass === 'syncing'
                        ? '<span class="ti ti-blinking-dot"></span>'
                        : '';

                    // Check if this plugin has a connect function (OAuth)
                    const hasConnect = this.connectFunctions.has(pluginId);
                    const isSyncing = status === 'syncing';

                    card.innerHTML = `
                        <div class="sync-card-header" style="cursor: pointer;">
                            <span class="sync-card-icon ti ti-${icon}"></span>
                            <span class="sync-card-name">${this.escapeHtml(pluginName)}</span>
                            <span class="sync-card-dot ${health.dotClass}">${dotContent}</span>
                        </div>
                        <div class="sync-card-body">
                            <div class="sync-card-value">${enabled === 'yes' ? this.escapeHtml(interval) : '—'}</div>
                            <div class="sync-card-label">${enabled === 'yes' ? 'interval' : 'paused'}</div>
                        </div>
                        <div class="sync-card-footer">
                            <div class="sync-card-time">${this.escapeHtml(health.timeText)}</div>
                            ${status === 'error' && record.prop('last_error')?.text() ?
                                `<div class="sync-card-error" title="${this.escapeHtml(record.prop('last_error')?.text() || '')}">${this.escapeHtml(record.prop('last_error')?.text()?.substring(0, 40) || '')}...</div>`
                                : ''}
                        </div>
                        <div class="sync-card-actions">
                            ${hasConnect ? `<button class="sync-card-btn connect" data-action="connect">Connect</button>` : ''}
                            <button class="sync-card-btn primary" data-action="sync" ${isSyncing ? 'disabled' : ''}>${isSyncing ? 'Syncing...' : 'Sync'}</button>
                            <button class="sync-card-btn" data-action="full" ${isSyncing ? 'disabled' : ''}>Full</button>
                        </div>
                    `;

                    // Header click opens config
                    card.querySelector('.sync-card-header').addEventListener('click', (e) => {
                        e.stopPropagation();
                        viewContext.openRecordInOtherPanel(record.guid);
                    });

                    // Button clicks
                    card.querySelectorAll('.sync-card-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const action = btn.getAttribute('data-action');
                            if (action === 'sync') {
                                this.requestSync(pluginId, { manual: true });
                            } else if (action === 'full') {
                                this.requestSync(pluginId, { full: true, manual: true });
                            } else if (action === 'connect') {
                                const connectFn = this.connectFunctions.get(pluginId);
                                if (connectFn) connectFn();
                            }
                        });
                    });

                    grid.appendChild(card);
                });

                container.appendChild(grid);

                // Summary row
                const summaryClass = errorCount > 0 ? 'error' : (enabledCount === healthyCount ? 'healthy' : 'warning');
                const desktopConnected = this.isDesktopConnected();
                const summary = document.createElement('div');
                summary.className = 'sync-dashboard-summary';
                summary.innerHTML = `
                    <div class="sync-summary-item">
                        <span class="sync-summary-value">${enabledCount}</span>
                        <span>plugins active</span>
                    </div>
                    <div class="sync-summary-item">
                        <span class="sync-summary-dot ${summaryClass}"></span>
                        <span>${errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : 'All healthy'}</span>
                    </div>
                    <div class="sync-summary-item desktop-status">
                        <span class="sync-summary-dot ${desktopConnected ? 'desktop-connected' : 'desktop-disconnected'}"></span>
                        <span>Desktop ${desktopConnected ? 'connected' : 'offline'}</span>
                    </div>
                `;
                container.appendChild(summary);
            };

            return {
                onLoad: () => {
                    viewContext.makeWideLayout();
                    element.style.overflow = 'auto';
                    container = document.createElement('div');
                    container.className = 'sync-dashboard';
                    element.appendChild(container);
                },
                onRefresh: ({ records: newRecords }) => {
                    records = newRecords;
                    renderDashboard();
                },
                onPanelResize: () => {},
                onDestroy: () => {
                    container = null;
                    records = [];
                },
                onFocus: () => {},
                onBlur: () => {},
                onKeyboardNavigation: () => {}
            };
        });
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text
     * @returns {string}
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async pasteMarkdownFromClipboard() {
        try {
            const markdown = await navigator.clipboard.readText();
            if (!markdown || !markdown.trim()) {
                this.ui.addToaster({
                    title: 'Paste Markdown',
                    message: 'Clipboard is empty',
                    dismissible: true,
                    autoDestroyTime: 2000,
                });
                return;
            }

            const record = this.ui.getActivePanel()?.getActiveRecord();
            if (!record) {
                this.ui.addToaster({
                    title: 'Paste Markdown',
                    message: 'No active record. Open a note first.',
                    dismissible: true,
                    autoDestroyTime: 3000,
                });
                return;
            }

            await this.insertMarkdown(markdown, record, null);
        } catch (error) {
            this.ui.addToaster({
                title: 'Paste Markdown',
                message: `Failed: ${error.message}`,
                dismissible: true,
                autoDestroyTime: 3000,
            });
        }
    }

    // =========================================================================
    // Plugin Registration API
    // =========================================================================

    /**
     * Register a sync plugin
     * @param {Object} config
     * @param {string} config.id - Unique plugin ID (e.g., 'github-sync')
     * @param {string} config.name - Display name
     * @param {string} config.icon - Icon class (e.g., 'ti-brand-github')
     * @param {Function} config.sync - Async function to perform sync
     * @param {string} config.defaultInterval - Default interval (e.g., '5m', '1h')
     */
    async registerPlugin(config) {
        const { id, name, icon, sync, defaultInterval = '5m' } = config;

        if (!id || !sync) {
            this.log(`Registration failed: missing id or sync function`, 'error');
            return null;
        }

        // Store the sync function
        this.syncFunctions.set(id, sync);
        console.log(`[SyncHub] Registered plugin: ${id} (${this.syncFunctions.size} total)`);

        // Find or create the plugin record
        let record = await this.findPluginRecord(id);

        if (!record) {
            record = await this.createPluginRecord({
                id,
                name,
                icon,
                defaultInterval,
            });
        }

        return record;
    }

    async unregisterPlugin(pluginId) {
        this.syncFunctions.delete(pluginId);
    }

    // =========================================================================
    // Record Management
    // =========================================================================

    async findPluginRecord(pluginId) {
        const records = await this.myCollection.getAllRecords();
        return records.find(r => r.text('plugin_id') === pluginId);
    }

    async createPluginRecord({ id, name, icon, defaultInterval }) {
        // Create a new record in this collection
        const recordGuid = this.myCollection.createRecord(name || id);
        if (!recordGuid) {
            this.log(`Failed to create record for plugin: ${id}`, 'error');
            return null;
        }

        // Wait for record to sync (SDK quirk - getRecord returns null immediately)
        await new Promise(resolve => setTimeout(resolve, 50));
        const records = await this.myCollection.getAllRecords();
        const record = records.find(r => r.guid === recordGuid);

        if (!record) {
            this.log(`Could not find created record: ${recordGuid}`, 'error');
            return null;
        }

        // Set the fields
        record.prop('plugin_id')?.set(id);
        record.prop('enabled')?.setChoice('yes');
        record.prop('status')?.setChoice('idle');
        record.prop('interval')?.setChoice(defaultInterval || '5m');
        record.prop('journal')?.setChoice('major_only');
        record.prop('toast')?.setChoice('new_records');
        record.prop('log_level')?.setChoice('info');

        // Set initial activity log
        await this.appendLog(record.guid, `Plugin registered: ${name || id}`);

        return record;
    }

    async getPluginStatus(pluginId) {
        const record = await this.findPluginRecord(pluginId);
        if (!record) return null;

        return {
            enabled: record.prop('enabled')?.value,
            status: record.prop('status')?.choice(),
            lastRun: record.prop('last_run')?.date(),
            lastError: record.prop('last_error')?.text(),
            interval: record.prop('interval')?.text(),
        };
    }

    // =========================================================================
    // Scheduling
    // =========================================================================

    startScheduler() {
        // Check every 30 seconds which plugins need to run
        this.schedulerInterval = setInterval(() => this.tick(), 30000);
    }

    stopScheduler() {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
    }

    async tick() {
        if (!this.myCollection) return;

        const records = await this.myCollection.getAllRecords();
        const now = Date.now();

        for (const record of records) {
            const pluginId = record.text('plugin_id');
            if (!pluginId) continue;

            const enabled = record.prop('enabled')?.choice();
            const status = record.prop('status')?.choice();
            const interval = record.prop('interval')?.choice();
            const lastRun = record.prop('last_run')?.date();

            if (enabled !== 'yes' || status === 'syncing' || interval === 'manual') continue;

            const intervalMs = this.parseInterval(interval);
            const lastRunMs = lastRun ? lastRun.getTime() : 0;

            if (now - lastRunMs >= intervalMs) {
                this.runSync(pluginId, record);
            }
        }
    }

    parseInterval(interval) {
        if (!interval) return 5 * 60 * 1000; // default 5m

        const match = interval.match(/^(\d+)(s|m|h|d)?$/);
        if (!match) return 5 * 60 * 1000;

        const value = parseInt(match[1], 10);
        const unit = match[2] || 'm';

        const multipliers = {
            's': 1000,
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
        };

        return value * (multipliers[unit] || 60000);
    }

    // =========================================================================
    // Sync Execution
    // =========================================================================

    /**
     * Request a sync for a plugin
     * @param {string} pluginId - The plugin ID
     * @param {Object} options - Optional settings
     * @param {boolean} options.full - If true, clears last_run to force full sync
     * @param {boolean} options.manual - If true, always show toast (for UI-triggered syncs)
     */
    async requestSync(pluginId, options = {}) {
        const record = await this.findPluginRecord(pluginId);
        if (!record) {
            this.log(`Cannot sync unknown plugin: ${pluginId}`, 'error');
            return;
        }

        // Full sync: clear last_run to force fetching everything
        if (options.full) {
            record.prop('last_run')?.set(null);
            console.log(`[SyncHub] Full sync requested for ${pluginId}, cleared last_run`);
        }

        await this.runSync(pluginId, record, { manual: options.manual });
    }

    /**
     * Register a connect function for OAuth plugins
     * Called from dashboard "Connect" button
     */
    registerConnect(pluginId, connectFn) {
        this.connectFunctions.set(pluginId, connectFn);
        console.log(`[SyncHub] Registered connect function for: ${pluginId}`);
    }

    async runSync(pluginId, record, options = {}) {
        const syncFn = this.syncFunctions.get(pluginId);
        if (!syncFn) {
            this.log(`No sync function for: ${pluginId}`, 'warn');
            return;
        }

        const logLevel = record.prop('log_level')?.choice() || 'info';
        const toastLevel = record.prop('toast')?.choice() || 'new_records';
        const journalLevel = record.prop('journal')?.choice() || 'none';
        const isManual = options.manual === true;

        // Update status to syncing
        record.prop('status')?.setChoice('syncing');
        this.currentlySyncing = pluginId;
        this.updateStatusBar();

        const startTime = Date.now();
        let result = null;
        let errorMsg = null;

        try {
            // Run sync with timeout (5 minutes max)
            const SYNC_TIMEOUT = 5 * 60 * 1000;
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Sync timeout (5 min)')), SYNC_TIMEOUT);
            });

            const syncPromise = syncFn({
                data: this.data,
                ui: this.ui,
                log: (msg) => this.appendLog(record.guid, msg, logLevel),
                debug: (msg) => {
                    if (logLevel === 'debug') {
                        this.appendLog(record.guid, `[debug] ${msg}`, logLevel);
                    }
                },
            });

            result = await Promise.race([syncPromise, timeoutPromise]);

        } catch (error) {
            errorMsg = error.message || String(error);
        } finally {
            // ALWAYS reset status - this is the key fix
            const duration = Date.now() - startTime;
            this.currentlySyncing = null;

            if (errorMsg) {
                record.prop('status')?.setChoice('error');
                record.prop('last_error')?.set(errorMsg);
                await this.appendLog(record.guid, `ERROR: ${errorMsg}`, 'error');

                if (toastLevel !== 'none') {
                    this.ui.addToaster({
                        title: `${pluginId} error`,
                        message: errorMsg,
                        dismissible: true,
                        autoDestroyTime: 5000,
                    });
                }
            } else {
                record.prop('status')?.setChoice('idle');
                record.prop('last_error')?.set(null);

                // Log changes
                const changes = result?.changes || [];
                for (const change of changes) {
                    await this.appendChangeLog(record.guid, change.verb, change.title, change.guid);
                }

                // At debug level: always log summary with duration
                // At info level: only log if we have changes (changes already logged above)
                if (logLevel === 'debug') {
                    const summary = result?.summary || 'Sync complete';
                    await this.appendLog(record.guid, `${summary} (${duration}ms)`, logLevel);
                }

                // Always toast for manual syncs, otherwise respect toast level
                if (isManual || this.shouldToast(toastLevel, result)) {
                    this.ui.addToaster({
                        title: pluginId,
                        message: result?.summary || 'Sync complete',
                        dismissible: true,
                        autoDestroyTime: 3000,
                    });
                }

                if (journalLevel !== 'none' && (result?.changes?.length || 0) > 0) {
                    await this.writeChangesToJournal(result.changes, journalLevel);
                }
            }

            this.setLastRun(record);
            this.updateStatusBar();
        }
    }

    shouldToast(level, result) {
        if (level === 'none') return false;
        if (level === 'all_updates') return true;
        if (level === 'new_records') return result?.created > 0;
        if (level === 'errors_only') return false; // errors handled separately
        return false;
    }

    // =========================================================================
    // Activity Logging
    // =========================================================================

    async appendChangeLog(syncHubRecordGuid, verb, title, targetRecordGuid) {
        const timestamp = this.formatTimestamp();

        // Append to Sync Hub record body with verb + title + record reference
        try {
            const record = this.data.getRecord(syncHubRecordGuid);
            if (!record) return;

            // Find the last top-level line item
            const existingItems = await record.getLineItems();
            const topLevelItems = existingItems.filter(item => item.parent_guid === record.guid);
            const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

            // Create new line item: **2025-01-15 15:21** verb "title" [Record]
            const newItem = await record.createLineItem(null, lastItem, 'text');
            if (newItem) {
                const segments = [
                    { type: 'bold', text: timestamp },
                    { type: 'text', text: ` ${verb}` }
                ];

                // Include title if provided (plugin controls format)
                if (title) {
                    segments.push({ type: 'text', text: ` ${title}` });
                }

                // Add record reference if provided
                if (targetRecordGuid) {
                    segments.push({ type: 'text', text: ' ' });
                    segments.push({ type: 'ref', text: { guid: targetRecordGuid } });
                }

                newItem.setSegments(segments);
            }
        } catch (e) {
            // Silently fail - logging shouldn't break sync
        }
    }

    formatTimestamp() {
        const now = new Date();
        const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const time = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return `${date} ${time}`;
    }

    async appendLog(recordGuid, message, logLevel = 'info') {
        const timestamp = this.formatTimestamp();

        const logLine = `${timestamp} ${message}`;

        // Only log to console in debug mode or for errors
        if (logLevel === 'debug' || logLevel === 'error') {
            console.log(`[SyncHub] [${recordGuid.slice(0,8)}] ${logLine}`);
        }

        // Append to record body with rich formatting
        try {
            const record = this.data.getRecord(recordGuid);
            if (!record) return;

            // Find the last top-level line item
            const existingItems = await record.getLineItems();
            const topLevelItems = existingItems.filter(item => item.parent_guid === record.guid);
            const lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

            // Create new line item after the last one
            const newItem = await record.createLineItem(null, lastItem, 'text');
            if (newItem) {
                newItem.setSegments([
                    { type: 'bold', text: timestamp },
                    { type: 'text', text: ` ${message}` }
                ]);
            }
        } catch (e) {
            // Silently fail - logging shouldn't break sync
        }
    }

    log(message, level = 'info') {
        const prefix = '[SyncHub]';
        if (level === 'error') {
            console.error(prefix, message);
        } else if (level === 'warn') {
            console.warn(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    // =========================================================================
    // Journal Integration
    // =========================================================================

    async getTodayJournalRecord() {
        try {
            const collections = await this.data.getAllCollections();
            const journalCollection = collections.find(c => c.getName() === 'Journal');
            if (!journalCollection) return null;

            // Journal guids end with the date in YYYYMMDD format
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // "20251231"

            const records = await journalCollection.getAllRecords();
            const todayRecord = records.find(r => r.guid.endsWith(today));

            return todayRecord || null;
        } catch (e) {
            return null;
        }
    }

    async writeChangesToJournal(changes, level) {
        const journalRecord = await this.getTodayJournalRecord();
        if (!journalRecord) return;

        // Filter changes based on level
        const filteredChanges = level === 'major_only'
            ? changes.filter(c => c.major)
            : changes;

        if (filteredChanges.length === 0) return;

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        try {
            // Find the last top-level line item
            const existingItems = await journalRecord.getLineItems();
            const topLevelItems = existingItems.filter(item => item.parent_guid === journalRecord.guid);
            let lastItem = topLevelItems.length > 0 ? topLevelItems[topLevelItems.length - 1] : null;

            for (const change of filteredChanges) {
                // Create parent line: **15:21** highlighted [[Record Title]]
                const parentItem = await journalRecord.createLineItem(null, lastItem, 'text');
                if (parentItem) {
                    parentItem.setSegments([
                        { type: 'bold', text: timestamp },
                        { type: 'text', text: ` ${change.verb} ` },
                        { type: 'ref', text: { guid: change.guid } }
                    ]);
                    lastItem = parentItem;

                    // For verbose mode, add children as nested items
                    if (level === 'verbose' && change.children && change.children.length > 0) {
                        let childLastItem = null;
                        for (const childText of change.children) {
                            // Truncate long highlights
                            const truncated = childText.length > 100
                                ? childText.slice(0, 100) + '...'
                                : childText;

                            const childItem = await journalRecord.createLineItem(parentItem, childLastItem, 'quote');
                            if (childItem) {
                                childItem.setSegments([{ type: 'text', text: truncated }]);
                                childLastItem = childItem;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Silently fail - journal shouldn't break sync
        }
    }

    // =========================================================================
    // Agent Tools - Collection-registered semantic operations
    // =========================================================================

    /**
     * Register tools for a collection.
     * Collections call this to expose semantic operations to agents.
     *
     * @param {Object} config
     * @param {string} config.collection - Collection name
     * @param {string} config.description - Human-readable description
     * @param {Object} config.schema - Field descriptions for the collection
     * @param {Array} config.tools - Array of tool definitions
     */
    registerCollectionTools(config) {
        const { collection, description, schema, tools } = config;

        if (!collection || !tools) {
            this.log('registerCollectionTools: missing collection or tools', 'error');
            return;
        }

        // Store the collection config
        this.collectionTools.set(collection, {
            description: description || collection,
            schema: schema || {},
            tools: tools || []
        });

        console.log(`[SyncHub] Registered ${tools.length} tools for collection: ${collection}`);
    }

    /**
     * Get all registered tools in OpenAI function calling format.
     * AgentHub calls this to build the tools array for LLM calls.
     */
    getRegisteredTools() {
        const allTools = [];

        // Add core tools (search, journal, etc.)
        allTools.push(...this.getCoreTools());

        // Add collection-specific tools
        for (const [collectionName, config] of this.collectionTools) {
            for (const tool of config.tools) {
                allTools.push({
                    type: 'function',
                    function: {
                        name: `${collectionName.toLowerCase()}_${tool.name}`,
                        description: `[${collectionName}] ${tool.description}`,
                        parameters: this.buildParameters(tool.parameters)
                    },
                    _handler: tool.handler,
                    _collection: collectionName
                });
            }
        }

        return allTools;
    }

    /**
     * Execute a tool call by name.
     * AgentHub calls this when the LLM invokes a tool.
     */
    async executeToolCall(name, args) {
        console.log(`[SyncHub] Executing tool: ${name}`, args);

        // Check core tools first
        const coreResult = await this.executeCoreToolCall(name, args);
        if (coreResult !== null) {
            return coreResult;
        }

        // Find collection tool
        for (const [collectionName, config] of this.collectionTools) {
            const prefix = collectionName.toLowerCase() + '_';
            if (name.startsWith(prefix)) {
                const toolName = name.slice(prefix.length);
                const tool = config.tools.find(t => t.name === toolName);
                if (tool?.handler) {
                    try {
                        return await tool.handler(args, this.data, this.ui);
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            }
        }

        return { error: `Unknown tool: ${name}` };
    }

    /**
     * Core tools available to all agents.
     */
    getCoreTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'search_workspace',
                    description: 'Search across all collections for relevant context. Use this to find information before answering questions.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query - keywords or phrases' },
                            limit: { type: 'number', description: 'Max results (default: 5)' }
                        },
                        required: ['query']
                    }
                },
                _core: true
            },
            {
                type: 'function',
                function: {
                    name: 'list_collections',
                    description: 'List all available collections and their schemas. Use this to understand what data is available.',
                    parameters: { type: 'object', properties: {}, required: [] }
                },
                _core: true
            },
            {
                type: 'function',
                function: {
                    name: 'get_note',
                    description: 'Get a note by GUID. Returns title, fields, and body content.',
                    parameters: {
                        type: 'object',
                        properties: {
                            guid: { type: 'string', description: 'Note GUID (from search results)' }
                        },
                        required: ['guid']
                    }
                },
                _core: true
            },
            {
                type: 'function',
                function: {
                    name: 'append_to_note',
                    description: 'Append markdown content to a note. Use search_workspace to find the GUID first.',
                    parameters: {
                        type: 'object',
                        properties: {
                            guid: { type: 'string', description: 'Note GUID (from search results)' },
                            content: { type: 'string', description: 'Markdown content to append' }
                        },
                        required: ['guid', 'content']
                    }
                },
                _core: true
            },
            {
                type: 'function',
                function: {
                    name: 'log_to_journal',
                    description: 'Add an entry to today\'s journal.',
                    parameters: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Content to add' }
                        },
                        required: ['content']
                    }
                },
                _core: true
            },
            {
                type: 'function',
                function: {
                    name: 'get_todays_journal',
                    description: 'Get today\'s journal/daily note content. Note: late night (2-3am) may still return yesterday\'s journal if the user hasn\'t created today\'s yet.',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                },
                _core: true
            }
        ];
    }

    /**
     * Execute core tool calls.
     */
    async executeCoreToolCall(name, args) {
        switch (name) {
            case 'search_workspace':
                return this.toolSearchWorkspace(args);
            case 'list_collections':
                return this.toolListCollections();
            case 'get_note':
                return this.toolGetNote(args);
            case 'append_to_note':
                return this.toolAppendToNote(args);
            case 'log_to_journal':
                return this.toolLogToJournal(args);
            case 'get_todays_journal':
                return this.toolGetTodaysJournal();
            default:
                return null; // Not a core tool
        }
    }

    async toolSearchWorkspace({ query, limit = 5 }) {
        try {
            const result = await this.data.searchByQuery(query, limit);
            return {
                query,
                results: (result.records || []).map(r => ({
                    guid: r.guid,
                    title: r.getName?.() || 'Untitled',
                    snippet: r.snippet || ''
                }))
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    toolListCollections() {
        const collections = {};
        for (const [name, config] of this.collectionTools) {
            collections[name] = {
                description: config.description,
                schema: config.schema,
                tools: config.tools.map(t => t.name)
            };
        }
        return { collections };
    }

    async toolGetNote({ guid }) {
        try {
            if (!guid) {
                return { error: 'GUID required' };
            }

            const record = await this.data.getRecordByGUID(guid);
            if (!record) {
                return { error: `Note not found: ${guid}` };
            }

            const props = record.getAllProperties?.() || [];
            const fields = {};
            for (const prop of props) {
                const value = prop.choice?.() || prop.text?.() || prop.number?.() || null;
                if (value) fields[prop.name || prop.id] = value;
            }

            const lineItems = await record.getLineItems?.() || [];
            const body = lineItems
                .filter(item => item.parent_guid === record.guid)
                .map(item => item.segments?.map(s => {
                    if (s.type === 'ref' && typeof s.text === 'object') {
                        return `[[${s.text.guid}]]`;
                    }
                    return s.text || '';
                }).join('') || '')
                .join('\n');

            return {
                guid: record.guid,
                title: record.getName?.() || 'Untitled',
                fields,
                body: body || '(empty)'
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    async toolAppendToNote({ guid, content }) {
        try {
            if (!guid) {
                return { error: 'GUID required' };
            }
            if (!content) {
                return { error: 'Content required' };
            }

            const record = await this.data.getRecordByGUID(guid);
            if (!record) {
                return { error: `Note not found: ${guid}` };
            }

            // Find last top-level item to append after
            const lineItems = await record.getLineItems?.() || [];
            const topLevel = lineItems.filter(item => item.parent_guid === record.guid);
            const lastItem = topLevel.length > 0 ? topLevel[topLevel.length - 1] : null;

            await this.insertMarkdown(content, record, lastItem);
            return { success: true, guid };
        } catch (e) {
            return { error: e.message };
        }
    }

    async toolLogToJournal({ content }) {
        try {
            const journal = await this.getTodayJournalRecord();
            if (!journal) {
                return { error: 'Journal not available' };
            }
            // Find last top-level item to append after
            const lineItems = await journal.getLineItems?.() || [];
            const topLevel = lineItems.filter(item => item.parent_guid === journal.guid);
            const lastItem = topLevel.length > 0 ? topLevel[topLevel.length - 1] : null;
            await this.insertMarkdown(content, journal, lastItem);
            return { success: true };
        } catch (e) {
            return { error: e.message };
        }
    }

    async toolGetTodaysJournal() {
        try {
            const journal = await this.getTodayJournalRecord();
            if (!journal) {
                return { error: 'No journal found for today. Open your daily note first to create it.' };
            }

            const props = journal.getAllProperties?.() || [];
            const fields = {};
            for (const prop of props) {
                const value = prop.choice?.() || prop.text?.() || prop.number?.() || null;
                if (value) fields[prop.name || prop.id] = value;
            }

            const lineItems = await journal.getLineItems?.() || [];
            const body = lineItems
                .filter(item => item.parent_guid === journal.guid)
                .map(item => item.segments?.map(s => {
                    if (s.type === 'ref' && typeof s.text === 'object') {
                        return `[[${s.text.guid}]]`;
                    }
                    return s.text || '';
                }).join('') || '')
                .join('\n');

            return {
                guid: journal.guid,
                title: journal.getName?.() || 'Today',
                date: journal.guid.slice(-8), // YYYYMMDD from GUID
                fields,
                body: body || '(empty)'
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    /**
     * Build OpenAI-compatible parameters object from simple schema.
     * Supports:
     *   - Simple: { field: 'string' } or { field: 'string?' } (optional)
     *   - With enum: { field: { type: 'string', enum: ['a', 'b'] } }
     *   - With description: { field: { type: 'string', description: '...' } }
     */
    buildParameters(params) {
        if (!params) return { type: 'object', properties: {}, required: [] };

        const properties = {};
        const required = [];

        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string') {
                // Simple format: 'string' or 'string?'
                const isRequired = !value.endsWith('?');
                const cleanType = value.replace('?', '');
                properties[key] = { type: cleanType };
                if (isRequired) required.push(key);
            } else if (typeof value === 'object') {
                // Complex format with type, enum, description
                properties[key] = { ...value };
                // If no explicit optional marker, assume required
                if (!value.optional) required.push(key);
            }
        }

        return { type: 'object', properties, required };
    }

    // =========================================================================
    // Markdown Utilities (shared via window.syncHub)
    // =========================================================================

    /**
     * Insert markdown into a record using promise chaining (non-blocking).
     * Flat structure - Thymer's heading folding provides hierarchy.
     */
    async insertMarkdown(markdown, targetRecord, afterItem = null) {
        if (!targetRecord) {
            this.log('insertMarkdown: No target record provided', 'error');
            return 0;
        }

        const record = targetRecord;
        const self = this;
        let promise = Promise.resolve(afterItem);
        let rendered = 0;
        let inCode = false, codeLang = '', codeLines = [];
        let isFirstBlock = true;

        for (const line of markdown.split('\n')) {
            // Code fence (handles indented fences)
            const fenceMatch = line.match(/^(\s*)```(.*)$/);
            if (fenceMatch) {
                if (inCode) {
                    const lang = codeLang, code = [...codeLines];
                    promise = promise.then(async (last) => {
                        const block = await record.createLineItem(null, last, 'block');
                        if (!block) return last;
                        try { block.setHighlightLanguage?.(self.normalizeLanguage(lang)); } catch(e) {}
                        block.setSegments([]);
                        let prev = null;
                        for (const cl of code) {
                            const li = await record.createLineItem(block, prev, 'text');
                            if (li) { li.setSegments([{type:'text',text:cl}]); prev = li; }
                        }
                        rendered++;
                        return block;
                    });
                    isFirstBlock = false;
                    inCode = false; codeLang = ''; codeLines = [];
                } else {
                    inCode = true;
                    codeLang = fenceMatch[2].trim();
                }
                continue;
            }

            if (inCode) { codeLines.push(line); continue; }
            if (!line.trim()) continue;

            const parsed = this.parseLine(line);
            if (!parsed) continue;

            const { type, segments, level } = parsed;
            const isHeading = type === 'heading';
            const needsBlankLine = BLANK_LINE_BEFORE_HEADINGS && isHeading && !isFirstBlock;

            promise = promise.then(async (last) => {
                let insertAfter = last;

                // Add blank line before headings (except first block)
                if (needsBlankLine) {
                    const blank = await record.createLineItem(null, insertAfter, 'text');
                    if (blank) {
                        blank.setSegments([]);
                        insertAfter = blank;
                    }
                }

                const item = await record.createLineItem(null, insertAfter, type);
                if (!item) return last;

                // Set heading size for h2-h6
                if (isHeading && level > 1) {
                    try { item.setHeadingSize?.(level); } catch(e) {}
                }

                item.setSegments(segments);
                rendered++;
                return item;
            });

            isFirstBlock = false;
        }

        await promise;
        return rendered;
    }

    /**
     * Simple hash function for content comparison.
     * Not cryptographic - just for change detection.
     */
    hashContent(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    /**
     * Replace all contents of a record with new markdown.
     * Uses hash to skip unchanged content, updates existing items in place.
     */
    async replaceContents(markdown, record) {
        if (!record) {
            this.log('replaceContents: No record provided', 'error');
            return 0;
        }

        // Check hash - skip if content unchanged
        const newHash = this.hashContent(markdown);
        const oldHash = record.text('content_hash');
        if (newHash === oldHash) {
            return 0; // No changes needed
        }

        // Get existing top-level line items
        const existingItems = await record.getLineItems();
        const topLevelItems = existingItems.filter(i => i.parent_guid === record.guid);

        // Parse new markdown into lines/blocks
        const newLines = this.parseMarkdownToLines(markdown);

        // Update existing items or create new ones
        let itemIndex = 0;
        let lastItem = null;

        for (const lineData of newLines) {
            if (itemIndex < topLevelItems.length) {
                // Update existing item
                const item = topLevelItems[itemIndex];
                item.setSegments(lineData.segments);
                // Note: can't change item type (heading vs text), but segments update works
                lastItem = item;
            } else {
                // Create new item
                const item = await record.createLineItem(null, lastItem, lineData.type);
                if (item) {
                    if (lineData.type === 'heading' && lineData.level > 1) {
                        try { item.setHeadingSize?.(lineData.level); } catch(e) {}
                    }
                    item.setSegments(lineData.segments);
                    lastItem = item;
                }
            }
            itemIndex++;
        }

        // Clear any extra existing items (can't delete, so empty them)
        for (let i = itemIndex; i < topLevelItems.length; i++) {
            topLevelItems[i].setSegments([]);
        }

        // Store new hash
        record.prop('content_hash')?.set(newHash);

        return newLines.length;
    }

    /**
     * Parse markdown into line data for replaceContents.
     * Simplified version that handles basic formatting.
     */
    parseMarkdownToLines(markdown) {
        const lines = [];
        let inCode = false, codeLang = '', codeLines = [];

        for (const line of markdown.split('\n')) {
            // Code fence
            const fenceMatch = line.match(/^(\s*)```(.*)$/);
            if (fenceMatch) {
                if (inCode) {
                    // End of code block - add as single block
                    lines.push({
                        type: 'block',
                        segments: [{ type: 'text', text: codeLines.join('\n') }],
                        lang: codeLang
                    });
                    inCode = false;
                    codeLang = '';
                    codeLines = [];
                } else {
                    inCode = true;
                    codeLang = fenceMatch[2].trim();
                }
                continue;
            }

            if (inCode) {
                codeLines.push(line);
                continue;
            }

            if (!line.trim()) continue;

            const parsed = this.parseLine(line);
            if (parsed) {
                lines.push(parsed);
            }
        }

        return lines;
    }

    /**
     * Parse a single line of markdown into type + segments.
     * Returns { type, segments, level? } or null for empty lines.
     */
    parseLine(line) {
        if (!line.trim()) return null;

        // Horizontal rule
        if (/^(\*\s*\*\s*\*|\-\s*\-\s*\-|_\s*_\s*_)[\s\*\-_]*$/.test(line.trim())) {
            return { type: 'br', segments: [] };
        }

        // Headings (returns level for setHeadingSize)
        const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (hMatch) {
            return {
                type: 'heading',
                level: hMatch[1].length,
                segments: this.parseInlineFormatting(hMatch[2])
            };
        }

        // Task list
        const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (taskMatch) {
            return { type: 'task', segments: this.parseInlineFormatting(taskMatch[3]) };
        }

        // Unordered list (handles indented items)
        const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
        if (ulMatch) {
            return { type: 'ulist', segments: this.parseInlineFormatting(ulMatch[2]) };
        }

        // Ordered list (handles indented items)
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olMatch) {
            return { type: 'olist', segments: this.parseInlineFormatting(olMatch[2]) };
        }

        // Quote
        if (line.startsWith('> ')) {
            return { type: 'quote', segments: this.parseInlineFormatting(line.slice(2)) };
        }

        // Regular text
        return { type: 'text', segments: this.parseInlineFormatting(line) };
    }

    /**
     * Parse inline formatting (bold, italic, code, links, record refs).
     * Exposed via window.syncHub for other plugins.
     *
     * Special: [[GUID]] creates a clickable record reference in Thymer.
     * Agents can use this to link to records they return from tool calls.
     */
    parseInlineFormatting(text) {
        const segments = [];
        const patterns = [
            { regex: /`([^`]+)`/, type: 'code' },
            { regex: /\[\[([A-Za-z0-9-]{20,})\]\]/, type: 'ref' },  // [[GUID]] record reference
            { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: 'link' },
            { regex: /\*\*([^*]+)\*\*/, type: 'bold' },
            { regex: /__([^_]+)__/, type: 'bold' },
            { regex: /\*([^*]+)\*/, type: 'italic' },
            { regex: /(?:^|[^a-zA-Z])_([^_]+)_(?:$|[^a-zA-Z])/, type: 'italic' },
        ];

        let remaining = text;

        while (remaining.length > 0) {
            let earliestMatch = null;
            let earliestIndex = remaining.length;
            let matchedPattern = null;

            for (const pattern of patterns) {
                const match = remaining.match(pattern.regex);
                if (match && match.index < earliestIndex) {
                    earliestMatch = match;
                    earliestIndex = match.index;
                    matchedPattern = pattern;
                }
            }

            if (earliestMatch && matchedPattern) {
                if (earliestIndex > 0) {
                    segments.push({ type: 'text', text: remaining.slice(0, earliestIndex) });
                }

                if (matchedPattern.type === 'link') {
                    // Links become plain text (Thymer doesn't support external links in segments)
                    segments.push({ type: 'text', text: earliestMatch[1] });
                } else if (matchedPattern.type === 'ref') {
                    // Record reference: [[GUID]] -> { type: 'ref', text: { guid: 'xxx' } }
                    segments.push({ type: 'ref', text: { guid: earliestMatch[1] } });
                } else {
                    segments.push({ type: matchedPattern.type, text: earliestMatch[1] });
                }

                remaining = remaining.slice(earliestIndex + earliestMatch[0].length);
            } else {
                segments.push({ type: 'text', text: remaining });
                break;
            }
        }

        return segments.length ? segments : [{ type: 'text', text }];
    }

    normalizeLanguage(lang) {
        if (!lang) return 'plaintext';
        const lower = lang.toLowerCase();
        const LANGUAGE_ALIASES = {
            'js': 'javascript', 'ts': 'typescript', 'py': 'python',
            'rb': 'ruby', 'sh': 'bash', 'yml': 'yaml', 'c++': 'cpp',
            'c#': 'csharp', 'cs': 'csharp', 'golang': 'go', 'rs': 'rust',
            'kt': 'kotlin', 'md': 'markdown', 'html': 'xml', 'htm': 'xml'
        };
        return LANGUAGE_ALIASES[lower] || lower;
    }

    /**
     * Set last_run datetime field using Thymer's DateTime class
     */
    setLastRun(record) {
        const prop = record.prop('last_run');
        if (!prop) return;

        const now = new Date();

        // Use DateTime class if available (Thymer global)
        if (typeof DateTime !== 'undefined') {
            const dt = new DateTime(now);
            prop.set(dt.value());
        } else {
            // Fallback to plain Date
            prop.set(now);
        }
    }

    // =========================================================================
    // Status Bar
    // =========================================================================

    /**
     * Build HTML label for SyncHub status bar (ti-server icon)
     */
    buildStatusLabel(state, extra = '') {
        const baseStyle = 'font-size: 16px;';
        let style = '';
        let iconStyle = baseStyle;

        switch (state) {
            case 'syncing':
                // Glow animation for syncing
                style = `<style>
                    @keyframes syncGlow {
                        0%, 100% { filter: drop-shadow(0 0 2px #60a5fa); opacity: 1; }
                        50% { filter: drop-shadow(0 0 6px #60a5fa); opacity: 0.8; }
                    }
                </style>`;
                iconStyle = `${baseStyle} color: #60a5fa; animation: syncGlow 1s ease-in-out infinite;`;
                break;
            case 'error':
                iconStyle = `${baseStyle} color: #f87171;`;
                break;
            case 'idle':
                iconStyle = `${baseStyle} color: #4ade80;`;
                break;
            case 'disabled':
                iconStyle = `${baseStyle} opacity: 0.4;`;
                break;
            default:
                iconStyle = `${baseStyle} opacity: 0.4;`;
        }

        return `${style}<span class="ti ti-server" style="${iconStyle}"></span>`;
    }

    /**
     * Build HTML label for MCP status bar (ti-wand icon)
     */
    buildMcpLabel(connected, active = false) {
        const baseStyle = 'font-size: 16px;';

        if (connected) {
            if (active) {
                // Glow animation for activity
                return `<style>
                    @keyframes mcpGlow {
                        0% { filter: drop-shadow(0 0 2px #a78bfa); }
                        100% { filter: drop-shadow(0 0 8px #a78bfa) drop-shadow(0 0 12px #a78bfa); }
                    }
                </style>
                <span class="ti ti-wand" style="${baseStyle} color: #a78bfa; animation: mcpGlow 0.15s ease-out;"></span>`;
            }
            return `<span class="ti ti-wand" style="${baseStyle} color: #a78bfa;"></span>`;
        } else {
            return `<span class="ti ti-wand" style="${baseStyle} opacity: 0.3;"></span>`;
        }
    }

    /**
     * Flash MCP indicator on activity
     */
    flashMcpActivity() {
        if (!this.mcpStatusBarItem || !this.isDesktopConnected()) return;

        // Show active state with glow
        this.mcpStatusBarItem.setHtmlLabel(this.buildMcpLabel(true, true));

        // Return to idle after flash
        clearTimeout(this.mcpFlashTimeout);
        this.mcpFlashTimeout = setTimeout(() => {
            if (this.isDesktopConnected()) {
                this.mcpStatusBarItem.setHtmlLabel(this.buildMcpLabel(true, false));
            }
        }, 150);
    }

    /**
     * Update MCP status bar
     */
    updateMcpStatusBar() {
        if (!this.mcpStatusBarItem) return;

        const connected = this.isDesktopConnected();
        this.mcpStatusBarItem.setHtmlLabel(this.buildMcpLabel(connected));

        if (connected) {
            const toolCount = this.getRegisteredTools().length;
            const duration = this.mcpConnectedAt
                ? this.formatRelativeTime(this.mcpConnectedAt)
                : 'just now';
            this.mcpStatusBarItem.setTooltip(`MCP connected (${toolCount} tools) - Connected ${duration}`);
        } else {
            this.mcpStatusBarItem.setTooltip('MCP disconnected - Click to connect this window');
        }
    }

    /**
     * Handle MCP status bar click - show popup menu
     */
    onMcpStatusBarClick(event) {
        this.showMcpPopup(event);
    }

    /**
     * Show MCP popup menu (cmdpal-style)
     */
    showMcpPopup(event) {
        // Remove existing popup if any
        this.closeMcpPopup();

        const connected = this.isDesktopConnected();
        const toolCount = this.getRegisteredTools().length;
        const duration = this.mcpConnectedAt ? this.formatRelativeTime(this.mcpConnectedAt) : '';

        // Build options
        const options = [];

        // Status header
        options.push({
            type: 'heading',
            label: 'MCP Status'
        });

        // Connection status
        if (connected) {
            options.push({
                type: 'info',
                icon: 'ti-circle-check',
                iconColor: 'var(--text-status-online)',
                label: `Connected (${toolCount} tools)`
            });
            options.push({
                type: 'info',
                label: `Connected ${duration}`
            });
        } else {
            options.push({
                type: 'info',
                icon: 'ti-circle-x',
                iconColor: 'var(--text-status-offline)',
                label: 'Disconnected'
            });
        }

        // Divider
        options.push({ type: 'divider' });

        // Actions
        if (connected) {
            options.push({
                type: 'action',
                icon: 'ti-refresh',
                label: 'Reconnect',
                action: () => this.connectToDesktop()
            });
            options.push({
                type: 'action',
                icon: 'ti-plug-off',
                label: 'Disconnect',
                action: () => this.disconnectFromDesktop()
            });
            options.push({
                type: 'action',
                icon: 'ti-list',
                label: 'Show Tools (console)',
                action: () => {
                    console.log('[MCP] Registered tools:', this.getRegisteredTools().map(t => t.function?.name || t.name));
                }
            });
        } else {
            options.push({
                type: 'action',
                icon: 'ti-plug',
                label: 'Connect',
                action: () => this.connectToDesktop()
            });
        }

        // Divider + activity log
        options.push({ type: 'divider' });
        options.push({
            type: 'action',
            icon: 'ti-activity',
            label: 'Activity Log',
            action: () => this.showMcpActivityPopup()
        });

        this.mcpPopup = this.createCmdpalPopup(options, event);
    }

    /**
     * Create a cmdpal-style popup
     */
    createCmdpalPopup(options, event) {
        const popup = document.createElement('div');
        popup.className = 'synchub-mcp-popup';
        popup.style.cssText = `
            position: fixed;
            width: 260px;
            z-index: 9999;
            background: var(--background-primary);
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            padding: 8px 0;
            font-size: 13px;
        `;

        // Position near the click (above the status bar)
        const rect = event?.target?.getBoundingClientRect?.();
        if (rect) {
            popup.style.bottom = `${window.innerHeight - rect.top + 8}px`;
            popup.style.left = `${Math.max(10, rect.left - 100)}px`;
        } else {
            popup.style.bottom = '50px';
            popup.style.right = '20px';
        }

        let html = '';

        for (const opt of options) {
            if (opt.type === 'heading') {
                html += `<div style="padding: 6px 12px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase;">${opt.label}</div>`;
            } else if (opt.type === 'info') {
                const iconHtml = opt.icon
                    ? `<span class="ti ${opt.icon}" style="margin-right: 8px; ${opt.iconColor ? `color: ${opt.iconColor};` : ''}"></span>`
                    : '<span style="width: 24px; display: inline-block;"></span>';
                html += `<div style="padding: 6px 12px; display: flex; align-items: center;">${iconHtml}<span>${opt.label}</span></div>`;
            } else if (opt.type === 'divider') {
                html += `<div style="border-top: 1px solid var(--divider-color); margin: 6px 0;"></div>`;
            } else if (opt.type === 'action') {
                const iconHtml = opt.icon ? `<span class="ti ${opt.icon}" style="margin-right: 8px;"></span>` : '<span style="width: 24px; display: inline-block;"></span>';
                html += `<div class="autocomplete--option synchub-popup-action" data-label="${opt.label}" style="padding: 6px 12px; display: flex; align-items: center; cursor: pointer;">${iconHtml}<span>${opt.label}</span></div>`;
            }
        }

        popup.innerHTML = html;

        // Add click handlers and hover effects for actions
        popup.querySelectorAll('.synchub-popup-action').forEach(el => {
            const label = el.dataset.label;
            const opt = options.find(o => o.type === 'action' && o.label === label);

            el.addEventListener('click', () => {
                opt?.action?.();
                this.closeMcpPopup();
            });

            el.addEventListener('mouseenter', () => {
                el.classList.add('autocomplete--option-selected');
            });
            el.addEventListener('mouseleave', () => {
                el.classList.remove('autocomplete--option-selected');
            });
        });

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', this._mcpPopupCloseHandler = (e) => {
                if (!popup.contains(e.target)) {
                    this.closeMcpPopup();
                }
            });
        }, 100);

        document.body.appendChild(popup);
        return popup;
    }

    /**
     * Close MCP popup
     */
    closeMcpPopup() {
        if (this.mcpPopup) {
            this.mcpPopup.remove();
            this.mcpPopup = null;
        }
        if (this._mcpPopupCloseHandler) {
            document.removeEventListener('click', this._mcpPopupCloseHandler);
            this._mcpPopupCloseHandler = null;
        }
    }

    /**
     * Show MCP activity log popup
     */
    showMcpActivityPopup() {
        // Remove existing
        if (this.mcpActivityPopup) {
            this.mcpActivityPopup.remove();
            this.mcpActivityPopup = null;
            return;
        }

        const popup = document.createElement('div');
        popup.className = 'synchub-activity-popup';
        popup.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 50px;
            width: 400px;
            max-height: 350px;
            z-index: 9999;
            background: var(--background-primary);
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 12px;
            overflow: hidden;
        `;

        popup.innerHTML = `
            <div style="padding: 8px 12px; border-bottom: 1px solid var(--divider-color); display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600;"><span class="ti ti-activity" style="margin-right: 6px;"></span>MCP Activity</span>
                <span class="ti ti-x synchub-activity-close" style="cursor: pointer; opacity: 0.6;"></span>
            </div>
            <div class="synchub-activity-log" style="max-height: 300px; overflow-y: auto; padding: 4px 0;"></div>
        `;

        popup.querySelector('.synchub-activity-close').addEventListener('click', () => {
            this.mcpActivityPopup.remove();
            this.mcpActivityPopup = null;
        });

        document.body.appendChild(popup);
        this.mcpActivityPopup = popup;
        this.updateMcpActivityPopup();
    }

    /**
     * Update MCP activity popup content
     */
    updateMcpActivityPopup() {
        if (!this.mcpActivityPopup) return;

        const logEl = this.mcpActivityPopup.querySelector('.synchub-activity-log');
        if (!logEl) return;

        if (this.mcpActivityLog.length === 0) {
            logEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No activity yet</div>';
            return;
        }

        let html = '';
        for (const entry of this.mcpActivityLog.slice(0, 20)) {
            const statusIcon = entry.status === 'success' ? 'ti-check'
                : entry.status === 'error' ? 'ti-x'
                : 'ti-loader';
            const statusColor = entry.status === 'success' ? 'var(--text-status-online)'
                : entry.status === 'error' ? 'var(--text-status-offline)'
                : 'var(--text-muted)';
            const statusAnim = entry.status === 'pending' ? 'animation: spin 1s linear infinite;' : '';

            // Truncate args for display
            const argsStr = JSON.stringify(entry.args);
            const argsShort = argsStr.length > 40 ? argsStr.slice(0, 40) + '...' : argsStr;

            const timeStr = entry.timestamp.toLocaleTimeString();
            const durationStr = entry.duration ? `${entry.duration}ms` : '';

            html += `
                <div style="padding: 6px 12px; border-bottom: 1px solid var(--divider-color); display: flex; align-items: center; gap: 8px;" title="${this.escapeHtml(argsStr)}${entry.error ? '\n\nError: ' + this.escapeHtml(entry.error) : ''}">
                    <span class="ti ${statusIcon}" style="color: ${statusColor}; ${statusAnim} flex-shrink: 0;"></span>
                    <span style="flex: 1; overflow: hidden;">
                        <span style="font-weight: 500;">${entry.tool}</span>
                        <span style="color: var(--text-muted); margin-left: 4px;">${this.escapeHtml(argsShort)}</span>
                    </span>
                    <span style="color: var(--text-muted); font-size: 10px; flex-shrink: 0;">${durationStr}</span>
                </div>
            `;
        }

        logEl.innerHTML = html;
    }

    /**
     * Escape HTML for safe display
     */
    escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Update status bar based on current sync state
     */
    async updateStatusBar() {
        if (!this.statusBarItem) return;

        try {
            const records = await this.myCollection?.getAllRecords() || [];

            // Check if currently syncing
            if (this.currentlySyncing) {
                const name = this.getPluginName(this.currentlySyncing);
                this.statusBarItem.setHtmlLabel(this.buildStatusLabel('syncing'));
                this.statusBarItem.setTooltip(`Syncing ${name}...`);
                return;
            }

            // Check for errors
            const errorRecords = records.filter(r => {
                const enabled = r.prop('enabled')?.choice() === 'yes';
                const status = r.prop('status')?.choice();
                return enabled && status === 'error';
            });

            if (errorRecords.length > 0) {
                const names = errorRecords.map(r => this.getPluginName(r.text('plugin_id'))).join(', ');
                this.statusBarItem.setHtmlLabel(this.buildStatusLabel('error'));
                this.statusBarItem.setTooltip(`Sync errors: ${names}`);
                return;
            }

            // Check enabled plugins
            const enabledRecords = records.filter(r => r.prop('enabled')?.choice() === 'yes');

            if (enabledRecords.length === 0) {
                this.statusBarItem.setHtmlLabel(this.buildStatusLabel('disabled'));
                this.statusBarItem.setTooltip('Sync Hub - No syncs enabled');
                return;
            }

            // Find most recent last_run for relative time
            let latestRun = null;
            for (const r of enabledRecords) {
                const lastRun = r.prop('last_run')?.date();
                if (lastRun && (!latestRun || lastRun > latestRun)) {
                    latestRun = lastRun;
                }
            }

            const relativeTime = latestRun ? this.formatRelativeTime(latestRun) : 'never';
            this.statusBarItem.setHtmlLabel(this.buildStatusLabel('idle'));
            this.statusBarItem.setTooltip(`Sync Hub - Last sync: ${relativeTime} (${enabledRecords.length} active)`);

        } catch (e) {
            // Silently ignore errors during status update
        }
    }

    /**
     * Get friendly plugin name from ID
     */
    getPluginName(pluginId) {
        const names = {
            'github-sync': 'GitHub',
            'readwise-sync': 'Readwise',
            'google-calendar-sync': 'Calendar',
        };
        return names[pluginId] || pluginId;
    }

    /**
     * Format relative time (e.g., "5m ago", "2h ago")
     */
    formatRelativeTime(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    /**
     * Handle status bar click - open Sync Hub collection
     */
    onStatusBarClick() {
        // TODO: Open Sync Hub collection view
        // For now, trigger sync all
        this.syncAll();
    }

    /**
     * Sync all enabled plugins
     */
    async syncAll() {
        try {
            const records = await this.myCollection?.getAllRecords() || [];
            const enabledRecords = records.filter(r => r.prop('enabled')?.choice() === 'yes');

            if (enabledRecords.length === 0) {
                this.ui.addToaster({
                    title: 'Sync Hub',
                    message: 'No syncs enabled',
                    dismissible: true,
                    autoDestroyTime: 2000,
                });
                return;
            }

            this.ui.addToaster({
                title: 'Sync Hub',
                message: `Syncing ${enabledRecords.length} plugins...`,
                dismissible: true,
                autoDestroyTime: 2000,
            });

            for (const record of enabledRecords) {
                const pluginId = record.text('plugin_id');
                if (pluginId && this.syncFunctions.has(pluginId)) {
                    await this.runSync(pluginId, record);
                }
            }

        } catch (e) {
            this.ui.addToaster({
                title: 'Sync Hub',
                message: `Sync all failed: ${e.message}`,
                dismissible: true,
                autoDestroyTime: 3000,
            });
        }
    }

    /**
     * Reset all stuck syncs to idle
     */
    async resetStuckSyncs() {
        try {
            const records = await this.myCollection?.getAllRecords() || [];
            let resetCount = 0;

            for (const record of records) {
                const status = record.prop('status')?.choice();
                if (status === 'syncing') {
                    record.prop('status')?.setChoice('idle');
                    record.prop('last_error')?.set('Reset by user');
                    resetCount++;
                }
            }

            this.currentlySyncing = null;
            this.updateStatusBar();

            this.ui.addToaster({
                title: 'Sync Hub',
                message: resetCount > 0 ? `Reset ${resetCount} stuck sync(s)` : 'No stuck syncs found',
                dismissible: true,
                autoDestroyTime: 2000,
            });

        } catch (e) {
            this.ui.addToaster({
                title: 'Sync Hub',
                message: `Reset failed: ${e.message}`,
                dismissible: true,
                autoDestroyTime: 3000,
            });
        }
    }

    // =========================================================================
    // Desktop Bridge - WebSocket connection to Thymer Desktop
    // =========================================================================

    /**
     * Connect to Thymer Desktop app for MCP bridge and CLI access.
     * Desktop exposes a WebSocket server that we connect to.
     */
    connectToDesktop() {
        // Don't connect in non-browser environments
        if (typeof WebSocket === 'undefined') return;

        // Don't connect if already connected or connecting
        if (this.desktopWs && this.desktopWs.readyState <= WebSocket.OPEN) {
            console.debug('[SyncHub] Already connected to Desktop, skipping');
            return;
        }

        const wsUrl = 'ws://127.0.0.1:9848';
        this.desktopReconnectAttempts = 0;
        this.desktopMaxReconnectAttempts = 5;
        this.desktopIntentionalClose = false;

        this._connectDesktopWebSocket(wsUrl);
    }

    _connectDesktopWebSocket(wsUrl) {
        // Check again in case of race
        if (this.desktopWs && this.desktopWs.readyState <= WebSocket.OPEN) {
            return;
        }

        try {
            this.desktopWs = new WebSocket(wsUrl);

            this.desktopWs.onopen = () => {
                console.log('[SyncHub] Connected to Thymer Desktop');
                this.desktopReconnectAttempts = 0;
                this.mcpConnectedAt = new Date();

                // Register ourselves
                this.desktopWs.send(JSON.stringify({
                    type: 'register',
                    version: '1.0.0'
                }));

                // Push current tools and plugins
                this._pushToolsToDesktop();
                this._pushPluginsToDesktop();

                // Update MCP status bar
                this.updateMcpStatusBar();
            };

            this.desktopWs.onmessage = (event) => {
                this._handleDesktopMessage(event.data);
            };

            this.desktopWs.onclose = (event) => {
                console.log('[SyncHub] Disconnected from Thymer Desktop');
                const wasIntentional = this.desktopIntentionalClose;
                this.desktopWs = null;
                this.mcpConnectedAt = null;

                // Update MCP status bar
                this.updateMcpStatusBar();

                // Don't reconnect if intentionally closed or if code 1000 (normal) / 1001 (going away)
                // Code 1008 = policy violation (server closed us for new client)
                if (wasIntentional || event.code === 1008) {
                    console.debug('[SyncHub] Not reconnecting (intentional or replaced by new client)');
                    return;
                }

                // Reconnect with backoff
                if (this.desktopReconnectAttempts < this.desktopMaxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, this.desktopReconnectAttempts), 30000);
                    this.desktopReconnectAttempts++;
                    console.debug(`[SyncHub] Reconnecting in ${delay}ms (attempt ${this.desktopReconnectAttempts})`);
                    setTimeout(() => this._connectDesktopWebSocket(wsUrl), delay);
                }
            };

            this.desktopWs.onerror = (err) => {
                // Silently handle - desktop app might not be running
                console.debug('[SyncHub] Desktop connection error (app may not be running)');
            };

        } catch (e) {
            console.debug('[SyncHub] Could not connect to Desktop:', e.message);
        }
    }

    disconnectFromDesktop() {
        if (this.desktopWs) {
            this.desktopIntentionalClose = true;
            this.desktopWs.close(1000, 'Plugin unloading');
            this.desktopWs = null;
        }
    }

    _handleDesktopMessage(data) {
        try {
            const msg = JSON.parse(data);

            // Handle requests from Desktop
            switch (msg.type) {
                case 'get_tools':
                    this._sendDesktopResponse(msg.id, this.getRegisteredTools());
                    break;

                case 'get_plugins':
                    this._sendDesktopResponse(msg.id, this._getPluginList());
                    break;

                case 'tool_call':
                    this.flashMcpActivity();
                    const callStart = Date.now();
                    const logEntry = {
                        id: msg.id,
                        tool: msg.name,
                        args: msg.args || {},
                        timestamp: new Date(),
                        status: 'pending'
                    };
                    this.mcpActivityLog.unshift(logEntry);
                    if (this.mcpActivityLog.length > 50) this.mcpActivityLog.pop();
                    this.updateMcpActivityPopup();

                    this.executeToolCall(msg.name, msg.args || {})
                        .then(result => {
                            logEntry.status = 'success';
                            logEntry.duration = Date.now() - callStart;
                            this.updateMcpActivityPopup();
                            this._sendDesktopResponse(msg.id, result);
                        })
                        .catch(err => {
                            logEntry.status = 'error';
                            logEntry.error = err.message;
                            logEntry.duration = Date.now() - callStart;
                            this.updateMcpActivityPopup();
                            this._sendDesktopError(msg.id, err.message);
                        });
                    break;

                case 'sync':
                    this.requestSync(msg.plugin)
                        .then(() => this._sendDesktopResponse(msg.id, { success: true }))
                        .catch(err => this._sendDesktopError(msg.id, err.message));
                    break;

                case 'sync_all':
                    this.syncAll()
                        .then(() => this._sendDesktopResponse(msg.id, { success: true }))
                        .catch(err => this._sendDesktopError(msg.id, err.message));
                    break;

                default:
                    console.debug('[SyncHub] Unknown desktop message type:', msg.type);
            }
        } catch (e) {
            console.error('[SyncHub] Failed to handle desktop message:', e);
        }
    }

    _sendDesktopResponse(id, result) {
        if (!this.desktopWs || this.desktopWs.readyState !== WebSocket.OPEN) return;
        this.desktopWs.send(JSON.stringify({ id, result }));
    }

    _sendDesktopError(id, error) {
        if (!this.desktopWs || this.desktopWs.readyState !== WebSocket.OPEN) return;
        this.desktopWs.send(JSON.stringify({ id, error }));
    }

    _pushToolsToDesktop() {
        if (!this.desktopWs || this.desktopWs.readyState !== WebSocket.OPEN) return;
        this.desktopWs.send(JSON.stringify({
            type: 'tools',
            tools: this.getRegisteredTools()
        }));
    }

    _pushPluginsToDesktop() {
        if (!this.desktopWs || this.desktopWs.readyState !== WebSocket.OPEN) return;
        this.desktopWs.send(JSON.stringify({
            type: 'plugins',
            plugins: this._getPluginList()
        }));
    }

    _getPluginList() {
        const plugins = [];
        for (const [pluginId, _] of this.syncFunctions) {
            plugins.push({
                name: pluginId,
                enabled: true // We only track registered (enabled) plugins
            });
        }
        return plugins;
    }

    /**
     * Check if connected to Thymer Desktop
     * @returns {boolean}
     */
    isDesktopConnected() {
        return this.desktopWs && this.desktopWs.readyState === WebSocket.OPEN;
    }
}
