import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ThymerConfig {
    workspace: string;           // e.g., "liberato"
    thymerUrl: string;          // e.g., "https://liberato.thymer.com"
    llmModel?: string;          // Default LLM model
    autoStartLLM?: boolean;     // Start LLM on launch
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'thymer-desktop');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

let cachedConfig: ThymerConfig | null = null;

/**
 * Get config directory path
 */
export function getConfigDir(): string {
    return CONFIG_DIR;
}

/**
 * Get config file path
 */
export function getConfigPath(): string {
    return CONFIG_FILE;
}

/**
 * Check if config exists (first run check)
 */
export function configExists(): boolean {
    return fs.existsSync(CONFIG_FILE);
}

/**
 * Load config from disk
 */
export function loadConfig(): ThymerConfig | null {
    if (cachedConfig) return cachedConfig;

    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return null;
        }
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        cachedConfig = JSON.parse(data);
        return cachedConfig;
    } catch (e) {
        console.error('[Config] Failed to load:', e);
        return null;
    }
}

/**
 * Save config to disk
 */
export function saveConfig(config: ThymerConfig): void {
    try {
        // Ensure directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        cachedConfig = config;
        console.log('[Config] Saved:', CONFIG_FILE);
    } catch (e) {
        console.error('[Config] Failed to save:', e);
        throw e;
    }
}

/**
 * Get workspace name, or null if not configured
 */
export function getWorkspace(): string | null {
    const config = loadConfig();
    return config?.workspace || null;
}

/**
 * Get Thymer URL for workspace
 */
export function getThymerUrl(): string | null {
    const config = loadConfig();
    return config?.thymerUrl || null;
}

/**
 * Set workspace (creates/updates config)
 */
export function setWorkspace(workspace: string): ThymerConfig {
    const existing = loadConfig() || {};
    const config: ThymerConfig = {
        ...existing,
        workspace: workspace.toLowerCase().trim(),
        thymerUrl: `https://${workspace.toLowerCase().trim()}.thymer.com`,
    };
    saveConfig(config);
    return config;
}

/**
 * Clear cached config (for testing or reload)
 */
export function clearConfigCache(): void {
    cachedConfig = null;
}
