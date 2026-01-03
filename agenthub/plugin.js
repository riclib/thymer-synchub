/**
 * AgentHub - AI agents that live in your Thymer space
 *
 * Each agent is a page in the AgentHub collection.
 * System prompt in a toggle at top, chat below.
 * Links bring context into the conversation.
 */

// Markdown config (consistent with SyncHub)
const BLANK_LINE_BEFORE_HEADINGS = true;

// Dashboard CSS
const DASHBOARD_CSS = `
    .agent-dashboard {
        padding: 24px;
        font-family: var(--font-family);
    }
    .agent-dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }
    .agent-card {
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
    .agent-card:hover {
        background: var(--bg-active, var(--bg-hover));
        border-color: rgba(255,255,255,0.2);
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        transform: translateY(-2px);
    }
    .agent-card[data-status="error"] {
        border-color: var(--enum-red-bg);
    }
    .agent-card[data-status="thinking"] {
        border-color: var(--enum-blue-bg);
    }
    .agent-card[data-enabled="no"] {
        opacity: 0.6;
        border-style: dashed;
    }
    .agent-card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
    }
    .agent-card-icon {
        font-size: 20px;
        color: var(--text-muted);
    }
    .agent-card-name {
        font-weight: 600;
        font-size: 14px;
        color: var(--text-default);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .agent-card-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--enum-green-bg);
    }
    .agent-card-dot.error {
        background: var(--enum-red-bg);
    }
    .agent-card-dot.disabled {
        background: var(--text-muted);
    }
    .agent-card-dot.thinking {
        background: none;
        width: auto;
        height: auto;
    }
    .agent-card-dot.thinking .ti-blinking-dot {
        color: var(--enum-blue-fg);
        font-size: 20px;
    }
    .agent-card-body {
        text-align: center;
        padding: 8px 0;
    }
    .agent-card-value {
        font-size: 36px;
        font-weight: 700;
        color: var(--text-default);
        line-height: 1;
        margin-bottom: 4px;
    }
    .agent-card-breakdown {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 8px;
    }
    .agent-card-breakdown .up { color: var(--enum-orange-fg, #f59e0b); }
    .agent-card-breakdown .down { color: var(--enum-blue-fg, #3b82f6); }
    .agent-card-breakdown .tps { color: var(--enum-green-fg, #22c55e); }
    .agent-card-label {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .agent-card-footer {
        text-align: center;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-default);
    }
    .agent-card-time {
        font-size: 12px;
        color: var(--text-muted);
    }
    .agent-card-invocations {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
    }
    .agent-card-error {
        font-size: 11px;
        color: var(--enum-red-fg);
        margin-top: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .agent-dashboard-summary {
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
    .agent-summary-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .agent-summary-value {
        font-weight: 600;
        color: var(--text-default);
    }
    .agent-summary-item .up { color: var(--enum-orange-fg, #f59e0b); }
    .agent-summary-item .down { color: var(--enum-blue-fg, #3b82f6); }
    .agent-summary-item .tps { color: var(--enum-green-fg, #22c55e); font-weight: 600; }
    .agent-dashboard-empty {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
    }
    .agent-dashboard-empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }
    .agent-dashboard-empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-default);
        margin-bottom: 8px;
    }
`;

// System prompt - explains context format to the LLM
const BASE_SYSTEM_PROMPT = `You are an AI assistant in Thymer, a personal workspace app.

## Context
- Linked records appear in "Linked Context" at the START of this conversation - already resolved
- When asked to verify, cross-check, or reference sources - look at the Linked Context above
- Do NOT call get_active_record or search tools for content already in Linked Context
- Your previous responses (and other agents') are marked with 🤖
- In multi-turn chats, the full source content remains in the first message

## Response Format
- Use [[GUID]] to link to records - renders as the record's title, so don't repeat the title
- Use markdown: headings, lists, bold, code blocks
- NEVER use markdown tables - they render as broken text. Use bullet lists instead.
- Answer directly from the provided context when possible`;

class Plugin extends CollectionPlugin {

    async onLoad() {
        this.agents = new Map();
        this.commands = [];

        // Wait for SyncHub to be ready (provides markdown utilities)
        if (!window.syncHub) {
            window.addEventListener('synchub-ready', () => this.initialize(), { once: true });
            // Timeout fallback
            setTimeout(() => {
                if (!this.initialized) this.initialize();
            }, 2000);
        } else {
            this.initialize();
        }
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        console.log('[AgentHub] Initializing' + (window.syncHub ? ' (SyncHub ready)' : ' (standalone)'));

        // Load agents and register commands (reload page for config changes)
        await this.loadAgents();

        // Register dashboard view
        this.registerDashboardView();
    }

    onUnload() {
        // Clean up commands
        if (this.commands) {
            for (const cmd of this.commands) {
                cmd.remove();
            }
            this.commands = [];
        }
    }

    // =========================================================================
    // Agent Loading
    // =========================================================================

    async loadAgents(quiet = false) {
        try {
            const collections = await this.data.getAllCollections();
            const agentHub = collections.find(c => c.getName() === 'AgentHub');

            if (!agentHub) {
                if (!quiet) console.log('[AgentHub] Collection not found');
                return;
            }

            const records = await agentHub.getAllRecords();

            // Clear old commands
            for (const cmd of this.commands) {
                cmd.remove();
            }
            this.commands = [];
            this.agents.clear();

            // Register each enabled agent
            for (const record of records) {
                const enabled = record.prop('enabled')?.choice();
                if (enabled !== 'yes') continue;

                const name = record.getName();
                const command = record.text('command') || `@${name.toLowerCase().replace(/\s+/g, '-')}`;
                const provider = record.prop('provider')?.choice() || 'anthropic';
                const model = record.prop('model')?.choice() || 'sonnet';
                const systemPrompt = record.text('system_prompt') || '';
                const customModel = record.text('custom_model');
                const customEndpoint = record.text('custom_endpoint');
                const token = record.text('token');

                this.agents.set(record.guid, {
                    guid: record.guid,
                    name,
                    command,
                    provider,
                    model,
                    systemPrompt,
                    customModel,
                    customEndpoint,
                    token,
                });

                // Register command palette command
                const cmd = this.ui.addCommandPaletteCommand({
                    label: `Chat with ${name}`,
                    icon: 'robot',
                    onSelected: () => this.openAgentChat(record.guid),
                });
                this.commands.push(cmd);
            }

            if (!quiet) {
                console.log(`[AgentHub] Loaded ${this.agents.size} agents`);
            }
        } catch (e) {
            console.error('[AgentHub] Failed to load agents:', e);
        }
    }

    // =========================================================================
    // Dashboard View
    // =========================================================================

    registerDashboardView() {
        this.ui.injectCSS(DASHBOARD_CSS);

        this.views.register("Dashboard", (viewContext) => {
            const element = viewContext.getElement();
            let records = [];
            let container = null;

            /**
             * Format number with k/M/G suffix (xxx.x format)
             * @param {number} num
             * @returns {string}
             */
            const formatTokens = (num) => {
                if (num === 0) return '0';
                if (num < 1000) return num.toString();
                if (num < 1000000) return (num / 1000).toFixed(1) + 'k';
                if (num < 1000000000) return (num / 1000000).toFixed(1) + 'M';
                return (num / 1000000000).toFixed(1) + 'G';
            };

            /**
             * Format relative time
             * @param {Date} date
             * @returns {string}
             */
            const formatRelativeTime = (date) => {
                if (!date) return 'Never';
                const now = new Date();
                const diff = now - date;
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);

                if (minutes < 1) return 'Just now';
                if (minutes < 60) return `${minutes}m ago`;
                if (hours < 24) return `${hours}h ago`;
                if (days < 7) return `${days}d ago`;
                return date.toLocaleDateString();
            };

            /**
             * Escape HTML to prevent XSS
             * @param {string} text
             * @returns {string}
             */
            const escapeHtml = (text) => {
                if (!text) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            };

            /**
             * Render the dashboard
             */
            const renderDashboard = () => {
                if (!container) return;
                container.innerHTML = '';

                // Filter to enabled agents
                const agents = records.filter(r => r.getName());

                if (agents.length === 0) {
                    container.innerHTML = `
                        <div class="agent-dashboard-empty">
                            <div class="agent-dashboard-empty-icon">🤖</div>
                            <div class="agent-dashboard-empty-title">No Agents</div>
                            <div>Create an agent to see it here</div>
                        </div>
                    `;
                    return;
                }

                // Create card grid
                const grid = document.createElement('div');
                grid.className = 'agent-dashboard-grid';

                let enabledCount = 0;
                let totalInputTokens = 0;
                let totalOutputTokens = 0;
                let totalInvocations = 0;

                let totalGenerationMs = 0;

                agents.forEach(record => {
                    const name = record.getName() || 'Unnamed Agent';
                    const enabled = record.prop('enabled')?.choice();
                    const status = record.prop('status')?.choice() || 'idle';
                    const lastRun = record.prop('last_run')?.date();
                    const inputTokens = record.prop('input_tokens')?.number() || 0;
                    const outputTokens = record.prop('output_tokens')?.number() || 0;
                    const generationMs = record.prop('total_generation_ms')?.number() || 0;
                    const invocations = record.prop('invocations')?.number() || 0;
                    const lastError = record.prop('last_error')?.text();
                    const provider = record.prop('provider')?.choice() || 'anthropic';
                    const model = record.prop('model')?.choice() || 'sonnet';

                    const totalTokens = inputTokens + outputTokens;
                    // TPS = output tokens / seconds (output is what we're generating)
                    const tps = generationMs > 0 ? (outputTokens / (generationMs / 1000)) : 0;

                    if (enabled === 'yes') {
                        enabledCount++;
                        totalInputTokens += inputTokens;
                        totalOutputTokens += outputTokens;
                        totalInvocations += invocations;
                        totalGenerationMs += generationMs;
                    }

                    // Determine status dot
                    let dotClass = '';
                    let dotContent = '';
                    if (enabled === 'no') {
                        dotClass = 'disabled';
                    } else if (status === 'thinking') {
                        dotClass = 'thinking';
                        dotContent = '<span class="ti ti-blinking-dot"></span>';
                    } else if (status === 'error') {
                        dotClass = 'error';
                    }

                    // Provider icon
                    const providerIcons = {
                        'anthropic': 'brand-anthropic',
                        'openai': 'brand-openai',
                        'ollama': 'box',
                        'custom': 'plug'
                    };
                    const icon = providerIcons[provider] || 'robot';

                    const card = document.createElement('div');
                    card.className = 'agent-card';
                    card.setAttribute('data-status', status);
                    card.setAttribute('data-enabled', enabled || 'no');

                    const timeText = lastRun ? formatRelativeTime(new Date(lastRun)) : 'Never used';

                    card.innerHTML = `
                        <div class="agent-card-header">
                            <span class="agent-card-icon ti ti-${icon}"></span>
                            <span class="agent-card-name">${escapeHtml(name)}</span>
                            <span class="agent-card-dot ${dotClass}">${dotContent}</span>
                        </div>
                        <div class="agent-card-body">
                            <div class="agent-card-value">${formatTokens(totalTokens)}</div>
                            <div class="agent-card-label">tokens</div>
                            ${totalTokens > 0 ? `
                                <div class="agent-card-breakdown">
                                    <span class="up">⬆ ${formatTokens(outputTokens)}</span>
                                    <span class="down">⬇ ${formatTokens(inputTokens)}</span>
                                    ${tps > 0 ? `<span class="tps">~${tps.toFixed(0)} tps</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                        <div class="agent-card-footer">
                            <div class="agent-card-time">${escapeHtml(timeText)} · ${escapeHtml(model)}</div>
                            ${invocations > 0 ? `<div class="agent-card-invocations">${invocations} chat${invocations !== 1 ? 's' : ''}</div>` : ''}
                            ${status === 'error' && lastError ?
                                `<div class="agent-card-error" title="${escapeHtml(lastError)}">${escapeHtml(lastError.substring(0, 40))}...</div>`
                                : ''}
                        </div>
                    `;

                    // Click to open agent config
                    card.addEventListener('click', () => {
                        viewContext.openRecordInOtherPanel(record.guid);
                    });

                    grid.appendChild(card);
                });

                container.appendChild(grid);

                // Summary row
                const totalTokensAll = totalInputTokens + totalOutputTokens;
                const overallTps = totalGenerationMs > 0 ? (totalOutputTokens / (totalGenerationMs / 1000)) : 0;
                const summary = document.createElement('div');
                summary.className = 'agent-dashboard-summary';
                summary.innerHTML = `
                    <div class="agent-summary-item">
                        <span class="agent-summary-value">${enabledCount}</span>
                        <span>agent${enabledCount !== 1 ? 's' : ''} active</span>
                    </div>
                    <div class="agent-summary-item">
                        <span class="agent-summary-value">${formatTokens(totalTokensAll)}</span>
                        <span>total tokens</span>
                    </div>
                    <div class="agent-summary-item">
                        <span class="up">⬆ ${formatTokens(totalOutputTokens)}</span>
                        <span class="down">⬇ ${formatTokens(totalInputTokens)}</span>
                    </div>
                    ${overallTps > 0 ? `
                        <div class="agent-summary-item">
                            <span class="tps">~${overallTps.toFixed(0)} tps</span>
                        </div>
                    ` : ''}
                    <div class="agent-summary-item">
                        <span class="agent-summary-value">${totalInvocations}</span>
                        <span>chats</span>
                    </div>
                `;
                container.appendChild(summary);
            };

            return {
                onLoad: () => {
                    viewContext.makeWideLayout();
                    element.style.overflow = 'auto';
                    container = document.createElement('div');
                    container.className = 'agent-dashboard';
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

    // =========================================================================
    // Chat Interface
    // =========================================================================

    async openAgentChat(agentGuid) {
        console.log('[AgentHub] openAgentChat called with:', agentGuid);
        // Navigate to agent page
        // For now, just trigger a completion on the current page
        await this.runCompletion(agentGuid);
    }

    async runCompletion(agentGuid) {
        console.log('[AgentHub] runCompletion started for:', agentGuid);

        const agent = this.agents.get(agentGuid);
        if (!agent) {
            console.error('[AgentHub] Agent not found in map:', agentGuid);
            console.log('[AgentHub] Available agents:', [...this.agents.keys()]);
            return;
        }
        console.log('[AgentHub] Found agent:', agent.name);

        // Get the ACTIVE record (where user is), not the agent's config page
        const activeRecord = this.ui.getActivePanel()?.getActiveRecord();
        if (!activeRecord) {
            console.error('[AgentHub] No active record');
            this.ui.addToaster({
                title: agent.name,
                message: 'Open a page first to chat',
                dismissible: true,
                autoDestroyTime: 3000,
            });
            return;
        }
        console.log('[AgentHub] Active record:', activeRecord.getName());

        // Get agent config record for status updates
        const collections = await this.data.getAllCollections();
        const agentHub = collections.find(c => c.getName() === 'AgentHub');
        const agentRecords = await agentHub.getAllRecords();
        const agentRecord = agentRecords.find(r => r.guid === agentGuid);

        // Set status to Thinking
        agentRecord?.prop('status')?.setChoice('thinking');

        // Build system prompt: our base + user's custom
        const baseSystemPrompt = this.getBaseSystemPrompt();
        const userSystemPrompt = agent.systemPrompt || '';
        const systemPrompt = userSystemPrompt
            ? `${baseSystemPrompt}\n\n---\nAdditional instructions:\n${userSystemPrompt}`
            : baseSystemPrompt;

        console.log('[AgentHub] Parsing page content...');
        const { messages, linkedContent } = await this.parseChatPage(activeRecord, agent.name);
        console.log('[AgentHub] Parsed:', { systemPrompt: systemPrompt?.slice(0, 50), messageCount: messages.length });

        if (messages.length === 0) {
            console.log('[AgentHub] No messages to process');
            agentRecord?.prop('status')?.setChoice('idle');
            this.ui.addToaster({
                title: agent.name,
                message: 'Write something first',
                dismissible: true,
                autoDestroyTime: 3000,
            });
            return;
        }

        // Get API key (agent-specific or from config)
        const apiKey = agent.token || await this.getSharedApiKey();
        console.log('[AgentHub] API key found:', apiKey ? 'yes (' + apiKey.slice(0, 10) + '...)' : 'no');

        if (!apiKey && agent.provider !== 'ollama' && agent.provider !== 'custom') {
            console.error('[AgentHub] No API key configured');
            agentRecord?.prop('status')?.setChoice('error');
            agentRecord?.prop('last_error')?.set('No API key configured');
            this.ui.addToaster({
                title: agent.name,
                message: 'No API key configured',
                dismissible: true,
                autoDestroyTime: 3000,
            });
            return;
        }

        // Build the full message array with linked content
        const fullMessages = this.buildMessages(messages, linkedContent);

        // Find the LAST item on the page to append after
        const allItems = await activeRecord.getLineItems();
        const topLevelItems = allItems.filter(item => item.parent_guid === activeRecord.guid);
        const lastItem = topLevelItems[topLevelItems.length - 1] || null;

        console.log('[AgentHub] Appending after last item:', lastItem?.guid);

        // Add blank line after last content
        const blankItem = await activeRecord.createLineItem(null, lastItem, 'text');
        blankItem?.setSegments([]);

        // Create label item for agent response with robot marker
        const labelItem = await activeRecord.createLineItem(null, blankItem, 'text');
        labelItem?.setSegments([{ type: 'bold', text: `${agent.name} 🤖:` }]);

        // Initialize streaming renderer
        const renderer = this.createStreamingRenderer(activeRecord, labelItem);
        await renderer.init();

        // Call LLM API with streaming - progressively render as chunks arrive
        console.log(`[AgentHub] Calling LLM: provider=${agent.provider}, model=${agent.model}`);
        try {
            const startTime = performance.now();
            const llmResult = await this.callLLMStreaming(
                agent,
                apiKey,
                systemPrompt,
                fullMessages,
                (text) => renderer.update(text)
            );
            const generationMs = Math.round(performance.now() - startTime);

            // Finalize rendering
            const renderResult = await renderer.finalize();
            console.log('[AgentHub] Rendered:', renderResult.rendered, 'items');

            // Add top-level blank line for user's next message
            const nextInputLine = await activeRecord.createLineItem(null, labelItem, 'text');
            nextInputLine?.setSegments([]);

            // Update stats (including token usage and generation time) and set status back to Idle
            await this.updateAgentStats(agentRecord, agent.name, llmResult?.usage, generationMs, activeRecord);
            agentRecord?.prop('status')?.setChoice('idle');

            if (llmResult?.usage) {
                const tps = generationMs > 0 ? ((llmResult.usage.output_tokens || 0) / (generationMs / 1000)).toFixed(1) : 0;
                console.log(`[AgentHub] Tokens: ${llmResult.usage.input_tokens} in, ${llmResult.usage.output_tokens} out | ${generationMs}ms | ${tps} tps`);
            }

            // Delight: Auto-generate title if page is untitled
            const currentName = activeRecord.getName()?.trim() || '';
            const isUntitled = !currentName ||
                               currentName.toLowerCase().startsWith('untitled') ||
                               currentName.toLowerCase().startsWith('new chat');
            console.log('[AgentHub] Current page name:', currentName, '- isUntitled:', isUntitled);
            if (isUntitled) {
                console.log('[AgentHub] Page untitled, suggesting title...');
                this.suggestTitle(agent, apiKey, fullMessages, activeRecord);
            }

        } catch (e) {
            console.error('[AgentHub] API error:', e);
            agentRecord?.prop('status')?.setChoice('error');
            agentRecord?.prop('last_error')?.set(e.message);

            // Show error in preview
            renderer.previewItem?.setSegments([
                { type: 'text', text: `Error: ${e.message}` },
            ]);
        }
    }

    // =========================================================================
    // System Prompt
    // =========================================================================

    getBaseSystemPrompt() {
        return BASE_SYSTEM_PROMPT;
    }

    // =========================================================================
    // Title Suggestion (Delight Feature)
    // =========================================================================

    async suggestTitle(agent, apiKey, messages, record) {
        try {
            console.log('[AgentHub] Suggesting title for chat...');

            // Build a simple prompt for title suggestion
            const conversation = messages.map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 200)}`
            ).join('\n');

            const titlePrompt = `Based on this conversation, suggest a very short title (3-5 words max, no quotes, no punctuation at end):

${conversation}

Title:`;

            // Quick non-streaming call
            const title = await this.quickCompletion(agent, apiKey, titlePrompt);

            if (title && title.length < 50) {
                const cleanTitle = title.trim()
                    .replace(/<\|.*?\|>/g, '')      // Strip model tokens like <|im_end|>, <|endoftext|>
                    .replace(/^["']|["']$/g, '')   // Remove wrapping quotes
                    .replace(/[.!?]$/, '')         // Remove trailing punctuation
                    .trim();
                console.log('[AgentHub] Setting title:', cleanTitle);
                if (cleanTitle) record.prop('title')?.set(cleanTitle);
            }
        } catch (e) {
            console.log('[AgentHub] Title suggestion failed (non-critical):', e.message);
            // Silent fail - this is just a delight feature
        }
    }

    async quickCompletion(agent, apiKey, prompt) {
        const { provider, model, customModel, customEndpoint } = agent;

        const messages = [{ role: 'user', content: prompt }];

        // Use appropriate endpoint based on provider
        let endpoint, headers, body;

        if (provider === 'anthropic') {
            endpoint = 'https://api.anthropic.com/v1/messages';
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            };
            body = {
                model: model === 'haiku' ? 'claude-3-haiku-20240307' : 'claude-sonnet-4-20250514',
                max_tokens: 50,
                messages,
            };
        } else if (provider === 'custom' || provider === 'ollama') {
            endpoint = customEndpoint || 'http://localhost:11434/api/chat';
            headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: customModel || 'default',
                max_tokens: 50,
                messages,
            };
        } else {
            // OpenAI format
            endpoint = customEndpoint || 'https://api.openai.com/v1/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            };
            body = {
                model: customModel || 'gpt-4o-mini',
                max_tokens: 50,
                messages,
            };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) return null;

        const data = await response.json();

        // Extract text based on provider format
        if (provider === 'anthropic') {
            return data.content?.[0]?.text || null;
        } else {
            return data.choices?.[0]?.message?.content || null;
        }
    }

    // =========================================================================
    // Page Parsing
    // =========================================================================

    /**
     * Parse a chat page into messages.
     * - Agent markers (**AgentName 🤖:**) and their CHILDREN are assistant messages
     * - Top-level items (not children of markers) are user content
     * - Links [[...]] get resolved and inlined as context
     */
    async parseChatPage(record, currentAgentName) {
        const items = await record.getLineItems();

        const messages = [];
        const linkedContent = new Map();

        // Pattern: **AgentName 🤖:** (bold text ending with robot emoji and colon)
        const agentMarkerPattern = /^(.+)\s*🤖:$/;

        // First pass: identify agent marker guids
        const agentMarkerGuids = new Set();
        for (const item of items) {
            if (item.parent_guid !== record.guid) continue; // Only top-level
            const firstSegment = item.segments?.[0];
            if (firstSegment?.type === 'bold') {
                const text = (item.segments || []).map(s => s.text || '').join('');
                if (agentMarkerPattern.test(text)) {
                    agentMarkerGuids.add(item.guid);
                }
            }
        }

        let currentRole = null;
        let currentContent = '';

        for (const item of items) {
            const parentGuid = item.parent_guid;
            const isTopLevel = parentGuid === record.guid;
            const isAgentChild = agentMarkerGuids.has(parentGuid);

            // Extract text, including ref GUIDs as [[GUID]] so LLM sees something
            const text = (item.segments || []).map(s => {
                if (s.type === 'ref' && typeof s.text === 'object') {
                    return `[[${s.text.guid}]]`;
                }
                return s.text || '';
            }).join('');

            // Skip items that are nested deeper (children of children)
            if (!isTopLevel && !isAgentChild) continue;

            if (isTopLevel) {
                // Check if this is an agent marker
                const firstSegment = item.segments?.[0];
                const isBoldMarker = firstSegment?.type === 'bold';
                const markerMatch = isBoldMarker && text.match(agentMarkerPattern);

                if (markerMatch) {
                    // Save previous message
                    if (currentRole && currentContent.trim()) {
                        messages.push({ role: currentRole, content: currentContent.trim() });
                    }
                    currentRole = 'assistant';
                    currentContent = '';
                } else if (text.trim()) {
                    // User content - save previous and start new
                    if (currentRole && currentContent.trim()) {
                        messages.push({ role: currentRole, content: currentContent.trim() });
                    }
                    currentRole = 'user';
                    currentContent = text;
                }
            } else if (isAgentChild && text.trim()) {
                // Child of agent marker = assistant content
                if (currentRole !== 'assistant') {
                    if (currentRole && currentContent.trim()) {
                        messages.push({ role: currentRole, content: currentContent.trim() });
                    }
                    currentRole = 'assistant';
                    currentContent = '';
                }
                currentContent += (currentContent ? '\n' : '') + text;
            }

            // Extract linked content for context
            const links = this.extractLinks(item.segments || []);
            for (const link of links) {
                if (link.guid && !linkedContent.has(link.guid)) {
                    const content = await this.resolveLink(link.guid);
                    if (content) {
                        linkedContent.set(link.guid, { title: link.title, content });
                    }
                }
            }
        }

        // Don't forget the last message
        if (currentRole && currentContent.trim()) {
            messages.push({ role: currentRole, content: currentContent.trim() });
        }

        console.log('[AgentHub] Parsed messages:', messages.length, 'linked:', linkedContent.size);
        return { messages, linkedContent };
    }

    extractLinks(segments) {
        // Extract linked records from segments (type: 'ref')
        const links = [];
        for (const segment of segments) {
            if (segment.type === 'ref' && segment.text?.guid) {
                links.push({
                    title: segment.text.title || 'Linked record',
                    guid: segment.text.guid
                });
            }
        }
        return links;
    }

    async resolveLink(guid) {
        // Resolve a block/page GUID to its content
        try {
            const collections = await this.data.getAllCollections();
            for (const collection of collections) {
                const records = await collection.getAllRecords();
                const record = records.find(r => r.guid === guid);
                if (record) {
                    const items = await record.getLineItems();
                    return items.map(i => (i.segments || []).map(s => {
                        // Handle ref segments (same fix as parseChatPage)
                        if (s.type === 'ref' && typeof s.text === 'object') {
                            return s.text.title || `[[${s.text.guid}]]`;
                        }
                        return s.text || '';
                    }).join('')).join('\n');
                }
            }
        } catch (e) {
            console.error('[AgentHub] Failed to resolve link:', e);
        }
        return null;
    }

    buildMessages(messages, linkedContent) {
        // Replace [[GUID]] with titles in all messages
        if (linkedContent.size > 0) {
            for (const [guid, { title }] of linkedContent) {
                const pattern = new RegExp(`\\[\\[${guid}\\]\\]`, 'g');
                for (let i = 0; i < messages.length; i++) {
                    messages[i] = {
                        ...messages[i],
                        content: messages[i].content.replace(pattern, `"${title}"`)
                    };
                }
            }
        }

        // If there's linked content, prepend it to the first user message
        if (linkedContent.size > 0 && messages.length > 0) {
            let contextBlock = '---\nLinked Context (already resolved - no need to search):\n';
            for (const [guid, { title, content }] of linkedContent) {
                contextBlock += `\n## ${title}\n${content}\n`;
            }
            contextBlock += '---\n\n';

            console.log('[AgentHub] Adding linked context block:', contextBlock.slice(0, 200) + '...');

            // Find first user message and prepend context
            const firstUserIdx = messages.findIndex(m => m.role === 'user');
            if (firstUserIdx >= 0) {
                messages[firstUserIdx] = {
                    ...messages[firstUserIdx],
                    content: contextBlock + messages[firstUserIdx].content,
                };
                console.log('[AgentHub] First user message now:', messages[firstUserIdx].content.slice(0, 300) + '...');
            }
        }

        return messages;
    }

    // =========================================================================
    // Anthropic API (Streaming)
    // =========================================================================

    async callLLMStreaming(agent, apiKey, systemPrompt, messages, onChunk) {
        const { provider, model, customModel, customEndpoint } = agent;

        // Route to appropriate provider
        switch (provider) {
            case 'openai':
                return this.callOpenAIStreaming(apiKey, model, customModel, customEndpoint, systemPrompt, messages, onChunk);
            case 'ollama':
                return this.callOllamaStreaming(model, customModel, customEndpoint, systemPrompt, messages, onChunk);
            case 'custom':
                return this.callCustomStreaming(apiKey, customModel, customEndpoint, systemPrompt, messages, onChunk);
            case 'anthropic':
            default:
                return this.callAnthropicStreaming(apiKey, model, customModel, systemPrompt, messages, onChunk);
        }
    }

    async callAnthropicStreaming(apiKey, modelChoice, customModel, systemPrompt, messages, onChunk, enableTools = true) {
        const modelMap = {
            'sonnet': 'claude-sonnet-4-5',
            'haiku': 'claude-haiku-4-5',
            'opus': 'claude-opus-4-5',
            'custom': customModel,
        };
        const model = modelMap[modelChoice] || customModel || 'claude-sonnet-4-5';

        // Get tools in Anthropic format
        const tools = enableTools ? this.getToolsForAnthropicAPI() : null;

        // Sanitize messages to remove invalid Unicode surrogates (can happen from local models)
        const sanitizedMessages = messages.map(m => ({
            ...m,
            content: typeof m.content === 'string'
                ? m.content.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
                : m.content
        }));

        const requestBody = {
            model,
            max_tokens: 4096,
            stream: true,
            system: systemPrompt?.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD') || undefined,
            messages: sanitizedMessages,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Anthropic API error ${response.status}: ${error}`);
        }

        const result = await this.processAnthropicStream(response, onChunk);

        // If we got tool results, continue the conversation
        if (result?.toolResults && result.toolResults.length > 0) {
            console.log('[AgentHub] Continuing with tool results...');

            // Build continuation messages
            const continuationMessages = [
                ...messages,
                {
                    role: 'assistant',
                    content: result.toolResults.map(tr => ({
                        type: 'tool_use',
                        id: tr.id,
                        name: tr.name,
                        input: {} // Original input not needed for response
                    }))
                },
                {
                    role: 'user',
                    content: [
                        ...result.toolResults.map(tr => ({
                            type: 'tool_result',
                            tool_use_id: tr.id,
                            content: JSON.stringify(tr.result)
                        })),
                        {
                            type: 'text',
                            text: 'Format nicely. Use [[GUID]] for clickable links - they render as the record title, so don\'t repeat the title next to the link.'
                        }
                    ]
                }
            ];

            // Make follow-up call (without tools to get final response)
            const followUpResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4096,
                    stream: true,
                    system: systemPrompt || undefined,
                    messages: continuationMessages,
                }),
            });

            if (!followUpResponse.ok) {
                const error = await followUpResponse.text();
                throw new Error(`Anthropic continuation error: ${error}`);
            }

            // Process the follow-up response (pass existing text to append to)
            const finalResult = await this.processAnthropicStream(followUpResponse, (text) => {
                onChunk(result.text + '\n' + text);
            });

            // Aggregate usage from both calls
            const totalUsage = {
                input_tokens: (result.usage?.input_tokens || 0) + (finalResult.usage?.input_tokens || 0),
                output_tokens: (result.usage?.output_tokens || 0) + (finalResult.usage?.output_tokens || 0)
            };
            return { text: result.text + '\n' + (finalResult.text || finalResult), usage: totalUsage };
        }

        return { text: result.text || result, usage: result.usage || { input_tokens: 0, output_tokens: 0 } };
    }

    /**
     * Get tools in Anthropic format (different from OpenAI)
     */
    getToolsForAnthropicAPI() {
        if (!window.syncHub?.getRegisteredTools) return [];

        const tools = window.syncHub.getRegisteredTools();
        // Convert from OpenAI format to Anthropic format
        return tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }));
    }

    async callOpenAIStreaming(apiKey, modelChoice, customModel, customEndpoint, systemPrompt, messages, onChunk, enableTools = true) {
        const modelMap = {
            'gpt-4o': 'gpt-4o',
            'gpt-4o-mini': 'gpt-4o-mini',
            'custom': customModel,
        };
        const model = modelMap[modelChoice] || customModel || 'gpt-4o';
        const endpoint = customEndpoint || 'https://api.openai.com/v1/chat/completions';

        console.log(`[AgentHub] Calling OpenAI: ${endpoint}, model: ${model}`);

        // Convert messages to OpenAI format (add system as first message)
        const openaiMessages = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, ...messages]
            : messages;

        // Get registered tools from SyncHub
        const tools = enableTools ? this.getToolsForAPI() : null;

        const requestBody = {
            model,
            max_tokens: 4096,
            stream: true,
            stream_options: { include_usage: true },  // Request token counts in stream
            messages: openaiMessages,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = 'auto';
            console.log(`[AgentHub] Sending ${tools.length} tools to OpenAI`);
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${error}`);
        }

        const result = await this.processOpenAIStream(response, onChunk);

        // Handle tool calls
        if (result?.toolCalls && result.toolCalls.length > 0) {
            console.log('[AgentHub] OpenAI tool calls detected:', result.toolCalls);

            let fullText = result.text || '';
            const toolResults = [];

            for (const tc of result.toolCalls) {
                try {
                    const args = tc.arguments ? JSON.parse(tc.arguments) : {};
                    console.log(`[AgentHub] Executing tool: ${tc.name}`, args);

                    fullText += `\n*Using ${tc.name}...*\n`;
                    onChunk(fullText);

                    const toolResult = await window.syncHub?.executeToolCall(tc.name, args);
                    toolResults.push({ id: tc.id, name: tc.name, result: toolResult });
                } catch (e) {
                    console.error('[AgentHub] Tool execution error:', e);
                    toolResults.push({ id: tc.id, name: tc.name, result: { error: e.message } });
                }
            }

            // Continue conversation with tool results
            const continuationMessages = [
                ...openaiMessages,
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: result.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments || '{}' }
                    }))
                },
                ...toolResults.map(tr => ({
                    role: 'tool',
                    tool_call_id: tr.id,
                    content: JSON.stringify(tr.result)
                })),
                { role: 'user', content: 'Format nicely. Use [[GUID]] for clickable links - they render as the record title, so don\'t repeat the title next to the link.' }
            ];

            // Follow-up call without tools
            const followUpResponse = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4096,
                    stream: true,
                    messages: continuationMessages,
                }),
            });

            if (followUpResponse.ok) {
                const finalResult = await this.processOpenAIStream(followUpResponse, (text) => {
                    onChunk(fullText + '\n' + text);
                });
                // Aggregate usage from both calls
                const totalUsage = {
                    input_tokens: (result.usage?.input_tokens || 0) + (finalResult.usage?.input_tokens || 0),
                    output_tokens: (result.usage?.output_tokens || 0) + (finalResult.usage?.output_tokens || 0)
                };
                return { text: fullText + '\n' + (finalResult?.text || finalResult), usage: totalUsage };
            }

            return { text: fullText, usage: result.usage || { input_tokens: 0, output_tokens: 0 } };
        }

        return { text: result?.text || result, usage: result?.usage || { input_tokens: 0, output_tokens: 0 } };
    }

    /**
     * Get tools in OpenAI format from SyncHub
     */
    getToolsForAPI() {
        if (!window.syncHub?.getRegisteredTools) return [];

        const tools = window.syncHub.getRegisteredTools();
        // Filter out internal properties, keep only OpenAI format
        return tools.map(t => ({
            type: t.type,
            function: t.function
        }));
    }

    async callOllamaStreaming(modelChoice, customModel, customEndpoint, systemPrompt, messages, onChunk, enableTools = true) {
        const model = customModel || modelChoice || 'llama3.2';
        const endpoint = customEndpoint || 'http://localhost:11434/api/chat';

        console.log(`[AgentHub] Calling Ollama: ${endpoint}, model: ${model}`);

        // Check for mixed content issue
        if (window.location.protocol === 'https:' && endpoint.startsWith('http://')) {
            throw new Error(`Mixed content blocked: Cannot call HTTP endpoint (${endpoint}) from HTTPS page. Use an HTTPS proxy or run Thymer locally.`);
        }

        // Convert to Ollama format
        const ollamaMessages = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, ...messages]
            : messages;

        // Get tools in OpenAI format (Ollama uses same format)
        const tools = enableTools ? this.getToolsForAPI() : null;

        const requestBody = {
            model,
            stream: true,
            messages: ollamaMessages,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            console.log(`[AgentHub] Sending ${tools.length} tools to Ollama`);
        }

        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
        } catch (fetchError) {
            throw new Error(`Failed to connect to Ollama at ${endpoint}: ${fetchError.message}`);
        }

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error ${response.status}: ${error}`);
        }

        const result = await this.processOllamaStream(response, onChunk);

        // Handle tool calls - similar to OpenAI flow
        if (result?.toolCalls && result.toolCalls.length > 0) {
            console.log('[AgentHub] Ollama tool calls detected:', result.toolCalls);

            const toolResults = [];
            for (const tc of result.toolCalls) {
                try {
                    const args = tc.arguments ? JSON.parse(tc.arguments) : {};
                    console.log(`[AgentHub] Executing tool: ${tc.name}`, args);

                    result.text += `\n*Using ${tc.name}...*\n`;
                    onChunk(result.text);

                    const toolResult = await window.syncHub?.executeToolCall(tc.name, args);
                    toolResults.push({ name: tc.name, result: toolResult });
                } catch (e) {
                    console.error('[AgentHub] Tool execution error:', e);
                    toolResults.push({ name: tc.name, result: { error: e.message } });
                }
            }

            // Continue conversation with tool results
            const continuationMessages = [
                ...ollamaMessages,
                { role: 'assistant', content: '', tool_calls: result.toolCalls.map((tc, i) => ({
                    id: `call_${i}`,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.arguments || '{}' }
                }))},
                ...toolResults.map((tr, i) => ({
                    role: 'tool',
                    tool_call_id: `call_${i}`,
                    content: JSON.stringify(tr.result)
                })),
                { role: 'user', content: 'Format nicely. Use [[GUID]] for clickable links - they render as the record title, so don\'t repeat the title next to the link.' }
            ];

            // Follow-up call without tools
            const followUpResponse = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, stream: true, messages: continuationMessages }),
            });

            if (followUpResponse.ok) {
                const finalResult = await this.processOllamaStream(followUpResponse, (text) => {
                    onChunk(result.text + '\n' + text);
                });
                // Aggregate usage from both calls
                const totalUsage = {
                    input_tokens: (result.usage?.input_tokens || 0) + (finalResult.usage?.input_tokens || 0),
                    output_tokens: (result.usage?.output_tokens || 0) + (finalResult.usage?.output_tokens || 0)
                };
                return { text: result.text + '\n' + (finalResult?.text || finalResult), usage: totalUsage };
            }

            return { text: result.text, usage: result.usage || { input_tokens: 0, output_tokens: 0 } };
        }

        return { text: result?.text || result, usage: result?.usage || { input_tokens: 0, output_tokens: 0 } };
    }

    async callCustomStreaming(apiKey, customModel, customEndpoint, systemPrompt, messages, onChunk, enableTools = true) {
        // Generic OpenAI-compatible endpoint
        if (!customEndpoint) throw new Error('Custom endpoint required');

        console.log(`[AgentHub] Calling custom endpoint: ${customEndpoint}, model: ${customModel}`);

        const customMessages = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, ...messages]
            : messages;

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // Get tools
        const tools = enableTools ? this.getToolsForAPI() : null;

        const requestBody = {
            model: customModel || 'default',
            stream: true,
            stream_options: { include_usage: true },  // Request token counts in stream
            messages: customMessages,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            console.log(`[AgentHub] Sending ${tools.length} tools to custom endpoint`);
        }

        const response = await fetch(customEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Custom API error ${response.status}: ${error}`);
        }

        const result = await this.processOpenAIStream(response, onChunk);

        // Handle tool calls
        if (result?.toolCalls && result.toolCalls.length > 0) {
            console.log('[AgentHub] Custom endpoint tool calls detected:', result.toolCalls);

            let fullText = result.text || '';
            const toolResults = [];

            for (const tc of result.toolCalls) {
                try {
                    const args = tc.arguments ? JSON.parse(tc.arguments) : {};
                    console.log(`[AgentHub] Executing tool: ${tc.name}`, args);

                    fullText += `\n*Using ${tc.name}...*\n`;
                    onChunk(fullText);

                    const toolResult = await window.syncHub?.executeToolCall(tc.name, args);
                    toolResults.push({ id: tc.id, name: tc.name, result: toolResult });
                } catch (e) {
                    console.error('[AgentHub] Tool execution error:', e);
                    toolResults.push({ id: tc.id, name: tc.name, result: { error: e.message } });
                }
            }

            // Continue conversation with tool results
            const continuationMessages = [
                ...customMessages,
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: result.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments || '{}' }
                    }))
                },
                ...toolResults.map(tr => ({
                    role: 'tool',
                    tool_call_id: tr.id,
                    content: JSON.stringify(tr.result)
                })),
                { role: 'user', content: 'Format nicely. Use [[GUID]] for clickable links - they render as the record title, so don\'t repeat the title next to the link.' }
            ];

            // Follow-up call without tools
            const followUpResponse = await fetch(customEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: customModel || 'default',
                    stream: true,
                    messages: continuationMessages,
                }),
            });

            if (followUpResponse.ok) {
                const finalResult = await this.processOpenAIStream(followUpResponse, (text) => {
                    onChunk(fullText + '\n' + text);
                });
                // Aggregate usage from both calls
                const totalUsage = {
                    input_tokens: (result.usage?.input_tokens || 0) + (finalResult.usage?.input_tokens || 0),
                    output_tokens: (result.usage?.output_tokens || 0) + (finalResult.usage?.output_tokens || 0)
                };
                return { text: fullText + '\n' + (finalResult?.text || finalResult), usage: totalUsage };
            }

            return { text: fullText, usage: result.usage || { input_tokens: 0, output_tokens: 0 } };
        }

        return { text: result?.text || result, usage: result?.usage || { input_tokens: 0, output_tokens: 0 } };
    }

    // Stream processors
    async processAnthropicStream(response, onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let toolUseBlocks = [];
        let currentToolUse = null;
        let usage = { input_tokens: 0, output_tokens: 0 };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const data = JSON.parse(jsonStr);

                        // Handle text content
                        if (data.type === 'content_block_delta' && data.delta?.text) {
                            fullText += data.delta.text;
                            onChunk(fullText);
                        }

                        // Handle tool_use block start
                        if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
                            currentToolUse = {
                                id: data.content_block.id,
                                name: data.content_block.name,
                                input: ''
                            };
                        }

                        // Handle tool_use input delta
                        if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
                            if (currentToolUse) {
                                currentToolUse.input += data.delta.partial_json || '';
                            }
                        }

                        // Handle tool_use block stop
                        if (data.type === 'content_block_stop' && currentToolUse) {
                            toolUseBlocks.push(currentToolUse);
                            currentToolUse = null;
                        }

                        // Capture usage from message_start and message_delta
                        if (data.type === 'message_start' && data.message?.usage) {
                            usage.input_tokens = data.message.usage.input_tokens || 0;
                        }
                        if (data.type === 'message_delta' && data.usage) {
                            usage.output_tokens = data.usage.output_tokens || 0;
                        }
                    } catch (e) {}
                }
            }
        }

        // If we have tool calls, execute them and return results for continuation
        if (toolUseBlocks.length > 0) {
            console.log('[AgentHub] Anthropic tool calls detected:', toolUseBlocks);

            const toolResults = [];
            for (const tc of toolUseBlocks) {
                if (tc.name) {
                    try {
                        const args = tc.input ? JSON.parse(tc.input) : {};
                        console.log(`[AgentHub] Executing tool: ${tc.name}`, args);

                        // Show tool being used
                        fullText += `\n*Using ${tc.name}...*\n`;
                        onChunk(fullText);

                        // Execute via SyncHub
                        const result = await window.syncHub?.executeToolCall(tc.name, args);
                        console.log('[AgentHub] Tool result:', result);

                        toolResults.push({
                            id: tc.id,
                            name: tc.name,
                            result: result
                        });
                    } catch (e) {
                        console.error('[AgentHub] Tool execution error:', e);
                        toolResults.push({
                            id: tc.id,
                            name: tc.name,
                            result: { error: e.message }
                        });
                    }
                }
            }

            // Return with tool results for continuation
            return {
                text: fullText,
                toolResults: toolResults,
                usage: usage
            };
        }

        return { text: fullText, usage: usage };
    }

    async processOpenAIStream(response, onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let toolCalls = [];
        let currentToolCall = null;
        let usage = { input_tokens: 0, output_tokens: 0 };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const data = JSON.parse(jsonStr);
                        const choice = data.choices?.[0];

                        // Handle text content
                        const delta = choice?.delta?.content;
                        if (delta) {
                            fullText += delta;
                            onChunk(fullText);
                        }

                        // Handle tool calls (streaming)
                        const toolCallDelta = choice?.delta?.tool_calls;
                        if (toolCallDelta) {
                            for (const tc of toolCallDelta) {
                                // OpenAI sends incrementally with index, MLX sends complete without index
                                const idx = tc.index ?? toolCalls.length;
                                if (!toolCalls[idx]) {
                                    toolCalls[idx] = {
                                        id: tc.id || `call_${idx}`,
                                        name: tc.function?.name || '',
                                        arguments: ''
                                    };
                                }
                                if (tc.id) toolCalls[idx].id = tc.id;
                                if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                                // MLX sends complete arguments as object, OpenAI sends as string chunks
                                if (tc.function?.arguments) {
                                    const args = tc.function.arguments;
                                    toolCalls[idx].arguments += typeof args === 'string' ? args : JSON.stringify(args);
                                }
                            }
                        }

                        // Capture usage (sent in final chunk with stream_options.include_usage)
                        if (data.usage) {
                            usage.input_tokens = data.usage.prompt_tokens || 0;
                            usage.output_tokens = data.usage.completion_tokens || 0;
                        }
                    } catch (e) {}
                }
            }
        }

        // Return object if tool calls detected, otherwise just text
        if (toolCalls.length > 0) {
            return { text: fullText, toolCalls, usage };
        }

        return { text: fullText, usage };
    }

    async processOllamaStream(response, onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let toolCalls = [];
        let usage = { input_tokens: 0, output_tokens: 0 };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);

                    // Handle text content
                    if (data.message?.content) {
                        fullText += data.message.content;
                        onChunk(fullText);
                    }

                    // Handle tool calls (Ollama format)
                    if (data.message?.tool_calls) {
                        for (const tc of data.message.tool_calls) {
                            toolCalls.push({
                                name: tc.function?.name,
                                arguments: JSON.stringify(tc.function?.arguments || {})
                            });
                        }
                    }

                    // Capture usage (Ollama sends in final message with done: true)
                    if (data.done && data.prompt_eval_count !== undefined) {
                        usage.input_tokens = data.prompt_eval_count || 0;
                        usage.output_tokens = data.eval_count || 0;
                    }
                } catch (e) {}
            }
        }

        // Return object if tool calls detected, otherwise just text
        if (toolCalls.length > 0) {
            return { text: fullText, toolCalls, usage };
        }
        return { text: fullText, usage };
    }

    // =========================================================================
    // Progressive Streaming Renderer
    // Uses promise chaining for non-blocking rendering during LLM streaming.
    // =========================================================================

    createStreamingRenderer(record, labelItem) {
        const self = this;

        return {
            record, labelItem,
            previewItem: null,
            processedLength: 0,
            buffer: '',
            inCodeBlock: false,
            codeBlockLang: '',
            renderedCount: 0,
            lastItemPromise: null,
            isFirstBlock: true,

            async init() {
                // All response items are children of the label (agent marker)
                this.lastItemPromise = Promise.resolve(null); // null = first child
                this.previewItem = await this.record.createLineItem(this.labelItem, null, 'text');
            },

            update(fullText) {
                const newText = fullText.slice(this.processedLength);
                if (!newText) return;

                for (const char of newText) {
                    this.buffer += char;
                    this.processedLength++;

                    if (this.inCodeBlock) {
                        if (this.buffer.endsWith('\n```\n') ||
                            (this.buffer.endsWith('\n```') && fullText.length === this.processedLength)) {
                            const endMarker = this.buffer.endsWith('\n```\n') ? '\n```\n' : '\n```';
                            this.renderCodeBlock(this.codeBlockLang, this.buffer.slice(0, -endMarker.length));
                            this.buffer = '';
                            this.inCodeBlock = false;
                            this.codeBlockLang = '';
                        }
                    } else if (char === '\n') {
                        const line = this.buffer.slice(0, -1);
                        const fenceMatch = line.match(/^(\s*)```(.*)$/);

                        if (fenceMatch) {
                            this.inCodeBlock = true;
                            this.codeBlockLang = fenceMatch[2].trim();
                            this.buffer = '';
                        } else if (line.trim()) {
                            this.renderLine(line);
                            this.buffer = '';
                        } else {
                            this.buffer = '';
                        }
                    }

                    this.updatePreview();
                }
            },

            renderLine(line) {
                const parsed = window.syncHub?.parseLine?.(line);
                if (!parsed?.segments?.length) return;

                const { type, segments, level } = parsed;
                const renderer = this;
                const isHeading = type === 'heading';
                const needsBlankLine = BLANK_LINE_BEFORE_HEADINGS && isHeading && !this.isFirstBlock;

                this.lastItemPromise = this.lastItemPromise.then(async (lastItem) => {
                    try {
                        let insertAfter = lastItem;

                        // Add blank line before headings (except first block)
                        if (needsBlankLine) {
                            const blank = await renderer.record.createLineItem(renderer.labelItem, insertAfter, 'text');
                            if (blank) {
                                blank.setSegments([]);
                                insertAfter = blank;
                            }
                        }

                        // Create as child of labelItem (agent marker)
                        const item = await renderer.record.createLineItem(renderer.labelItem, insertAfter, type);
                        if (item) {
                            if (isHeading && level > 1) {
                                try { item.setHeadingSize?.(level); } catch(e) {}
                            }
                            item.setSegments(segments);
                            renderer.renderedCount++;
                            renderer.isFirstBlock = false;
                            return item;
                        }
                        return lastItem;
                    } catch (e) {
                        return lastItem;
                    }
                });
            },

            renderCodeBlock(lang, content) {
                const lines = content.split('\n');
                const renderer = this;

                this.lastItemPromise = this.lastItemPromise.then(async (lastItem) => {
                    try {
                        // Create code block as child of labelItem (agent marker)
                        const block = await renderer.record.createLineItem(renderer.labelItem, lastItem, 'block');
                        if (!block) return lastItem;

                        try { block.setHighlightLanguage?.(self.normalizeLanguage(lang)); } catch(e) {}
                        block.setSegments([]);

                        let prev = null;
                        for (const codeLine of lines) {
                            const li = await renderer.record.createLineItem(block, prev, 'text');
                            if (li) { li.setSegments([{ type: 'text', text: codeLine }]); prev = li; }
                        }

                        renderer.renderedCount++;
                        renderer.isFirstBlock = false;
                        return block;
                    } catch (e) {
                        return lastItem;
                    }
                });
            },

            updatePreview() {
                if (!this.previewItem) return;
                try {
                    const display = this.buffer || '';
                    this.previewItem.setSegments([
                        ...(display ? [{ type: this.inCodeBlock ? 'code' : 'text', text: display }] : []),
                        { type: 'code', text: '█' }
                    ]);
                } catch (e) {}
            },

            async finalize() {
                if (this.buffer.trim()) {
                    if (this.inCodeBlock) {
                        this.renderCodeBlock(this.codeBlockLang, this.buffer);
                    } else {
                        this.renderLine(this.buffer);
                    }
                }

                await this.lastItemPromise;

                try {
                    this.previewItem?.setSegments([]);
                } catch (e) {}

                return { rendered: this.renderedCount };
            },
        };
    }

    normalizeLanguage(lang) {
        if (!lang) return 'plaintext';
        const aliases = {
            'js': 'javascript', 'ts': 'typescript', 'py': 'python',
            'rb': 'ruby', 'sh': 'bash', 'yml': 'yaml',
        };
        return aliases[lang.toLowerCase()] || lang.toLowerCase();
    }

    // =========================================================================
    // Stats
    // =========================================================================

    async updateAgentStats(record, agentName, usage = null, generationMs = 0, chatRecord = null) {
        try {
            const count = record.prop('invocations')?.number() || 0;
            record.prop('invocations')?.set(count + 1);

            // Track token usage
            if (usage) {
                const inputTokens = record.prop('input_tokens')?.number() || 0;
                const outputTokens = record.prop('output_tokens')?.number() || 0;
                record.prop('input_tokens')?.set(inputTokens + (usage.input_tokens || 0));
                record.prop('output_tokens')?.set(outputTokens + (usage.output_tokens || 0));
            }

            // Track generation time
            if (generationMs > 0) {
                const totalMs = record.prop('total_generation_ms')?.number() || 0;
                record.prop('total_generation_ms')?.set(totalMs + generationMs);
            }

            // Use SyncHub's setLastRun if available, otherwise fallback
            if (window.syncHub?.setLastRun) {
                window.syncHub.setLastRun(record);
            } else if (typeof DateTime !== 'undefined') {
                record.prop('last_run')?.set(new DateTime(new Date()).value());
            }

            // Log to journal if available - link to chat page, mention agent
            if (window.syncHub?.logToJournal && chatRecord) {
                const chatTitle = chatRecord.getName()?.trim() || 'Untitled Chat';
                console.log(`[AgentHub] Logging to journal: chatted with ${agentName} about ${chatTitle}`);
                await window.syncHub.logToJournal([{
                    verb: `chatted with ${agentName} about`,
                    guid: chatRecord.guid,
                    major: false,
                }], 'verbose');
            } else {
                console.log(`[AgentHub] Journal logging skipped: syncHub.logToJournal=${!!window.syncHub?.logToJournal}, chatRecord=${!!chatRecord}`);
            }
        } catch (e) {
            // Stats update is non-critical
        }
    }

    async getSharedApiKey() {
        // Look for shared API key in AgentHub config record or SyncHub
        try {
            const collections = await this.data.getAllCollections();

            // Check SyncHub for agenthub config
            const syncHub = collections.find(c => c.getName() === 'Sync Hub');
            if (syncHub) {
                const records = await syncHub.getAllRecords();
                const config = records.find(r => r.text('plugin_id') === 'agenthub');
                if (config) {
                    return config.text('token');
                }
            }
        } catch (e) {
            console.error('[AgentHub] Failed to get shared API key:', e);
        }
        return null;
    }
}
