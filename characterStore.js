const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class CharacterStore {
    constructor() {
        this.store = null;
    }

    async initializeStore() {
        try {
            const { default: Store } = await import('electron-store');
            // Use a dev-specific store name to avoid conflicts with installed version
            // app.isPackaged is false in dev mode (npm start), true in built exe
            const isDev = !app.isPackaged;
            this.store = new Store({
                name: isDev ? 'config-dev' : 'config'
            });

            // Try to get the characters, if it fails, we'll reset the store
            try {
                this.store.get('characters');
            } catch (error) {
                console.error('Error reading store, resetting...', error);
                this.store.clear();
            }

            if (!this.store.has('characters') || !this.store.has('apiKey')) {
                const charactersPath = path.join(__dirname, 'characters.json');
                const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
                
                const characterData = {};
                for (const [name, data] of Object.entries(characters)) {
                    characterData[name] = {
                        id: data.character_id,
                        spawn: false,
                        session_id: -1,
                        isUserAdded: false,
                        archived: false
                    };
                }

                this.store.set('characters', characterData);
                this.store.set('apiKey', '');
            }

            // Migration: add isUserAdded and archived fields to existing characters
            const existingChars = this.store.get('characters');
            let needsMigration = false;
            for (const [name, data] of Object.entries(existingChars)) {
                if (data.isUserAdded === undefined) {
                    data.isUserAdded = false;
                    needsMigration = true;
                }
                if (data.archived === undefined) {
                    data.archived = false;
                    needsMigration = true;
                }
            }
            if (needsMigration) {
                this.store.set('characters', existingChars);
            }

            // Add settings initialization
            if (!this.store.has('settings')) {
                this.store.set('settings', {
                    defaultFrameDuration: 200,
                    defaultMoveDuration: 12,
                    accentColor: '#ec4899',
                    petSize: 100,        // Percentage: 50-200
                    petOpacity: 100,     // Percentage: 30-100
                    animationSpeed: 1.0  // Multiplier: 0.5-2.0
                });
            }

            // Migration: add new settings fields if missing
            const existingSettings = this.store.get('settings');
            let settingsUpdated = false;
            if (existingSettings) {
                if (!existingSettings.accentColor) {
                    existingSettings.accentColor = '#ec4899';
                    settingsUpdated = true;
                }
                if (existingSettings.petSize === undefined) {
                    existingSettings.petSize = 100;
                    settingsUpdated = true;
                }
                if (existingSettings.petOpacity === undefined) {
                    existingSettings.petOpacity = 100;
                    settingsUpdated = true;
                }
                if (existingSettings.animationSpeed === undefined) {
                    existingSettings.animationSpeed = 1.0;
                    settingsUpdated = true;
                }
                if (settingsUpdated) {
                    this.store.set('settings', existingSettings);
                }
            }
        } catch (error) {
            console.error('Failed to initialize store:', error);
            throw error;
        }
    }

    getCharacterId(name) {
        const characters = this.store.get('characters');
        return characters[name]?.id;
    }

    getCharacterSpawn(name) {
        const characters = this.store.get('characters');
        return characters[name]?.spawn;
    }

    getAllCharacters() {
        return this.store.get('characters');
    }

    setCharacter(name, id, spawn = false) {
        const characters = this.store.get('characters');
        characters[name] = { id, spawn, session_id: -1 };
        this.store.set('characters', characters);
    }

    setCharacterSpawn(name, spawn) {
        const characters = this.store.get('characters');
        if (characters[name]) {
            characters[name].spawn = spawn;
            this.store.set('characters', characters);
        }
    }

    getApiKey() {
        return this.store.get('apiKey');
    }

    setApiKey(key) {
        this.store.set('apiKey', key);
    }

    setCharacterId(name, newId) {
        const characters = this.store.get('characters');
        if (characters[name]) {
            characters[name].id = newId;
            this.store.set('characters', characters);
        }
    }

    getCharacterSessionId(name) {
        const characters = this.store.get('characters');
        return characters[name]?.session_id;
    }

    setCharacterSessionId(name, sessionId) {
        const characters = this.store.get('characters');
        if (characters[name]) {
            characters[name].session_id = sessionId;
            this.store.set('characters', characters);
        }
    }

    getSettings() {
        return this.store.get('settings');
    }

    updateSettings(settings) {
        this.store.set('settings', settings);
    }

    // Rename a character (updates store and returns old/new names for folder renaming)
    renameCharacter(oldName, newName) {
        // Validate new name
        const sanitizedName = newName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!sanitizedName || sanitizedName.length === 0) {
            throw new Error('Invalid character name. Use only letters, numbers, underscores, and hyphens.');
        }

        const characters = this.store.get('characters');
        
        // Check if old name exists
        if (!characters[oldName]) {
            throw new Error(`Character "${oldName}" not found.`);
        }

        // Check if new name already exists (and it's not the same as old)
        if (sanitizedName !== oldName && characters[sanitizedName]) {
            throw new Error(`Character "${sanitizedName}" already exists.`);
        }

        // If same name, just return
        if (sanitizedName === oldName) {
            return { oldName, newName: sanitizedName, renamed: false };
        }

        // Move character data to new key
        const characterData = characters[oldName];
        delete characters[oldName];
        characters[sanitizedName] = characterData;
        
        this.store.set('characters', characters);
        
        return { oldName, newName: sanitizedName, renamed: true };
    }

    // Add a new character
    addCharacter(name, characterId, animationConfig) {
        const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!sanitizedName || sanitizedName.length === 0) {
            throw new Error('Invalid character name. Use only letters, numbers, underscores, and hyphens.');
        }

        const characters = this.store.get('characters');
        
        if (characters[sanitizedName]) {
            throw new Error(`Character "${sanitizedName}" already exists.`);
        }

        // Add to store - mark as user-added
        characters[sanitizedName] = {
            id: characterId,
            spawn: false,
            session_id: -1,
            isUserAdded: true,
            archived: false
        };
        this.store.set('characters', characters);

        return sanitizedName;
    }

    // Archive/unarchive a character
    setCharacterArchived(name, archived) {
        const characters = this.store.get('characters');
        if (characters[name]) {
            characters[name].archived = archived;
            // If archiving, also disable spawn
            if (archived) {
                characters[name].spawn = false;
            }
            this.store.set('characters', characters);
        }
    }

    // Check if character is user-added
    isUserAddedCharacter(name) {
        const characters = this.store.get('characters');
        return characters[name]?.isUserAdded || false;
    }

    // Delete a character (only user-added characters can be deleted)
    deleteCharacter(name) {
        const characters = this.store.get('characters');
        if (!characters[name]) {
            throw new Error(`Character "${name}" not found.`);
        }
        if (!characters[name].isUserAdded) {
            throw new Error(`Cannot delete default character "${name}". You can only archive it.`);
        }
        delete characters[name];
        this.store.set('characters', characters);
    }

    // Get animation config for a character from characters.json
    getAnimationConfig(name) {
        const charactersPath = path.join(__dirname, 'characters.json');
        const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
        return characters[name] || null;
    }

    // Save animation config to characters.json
    saveAnimationConfig(name, config) {
        const charactersPath = path.join(__dirname, 'characters.json');
        const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
        characters[name] = config;
        fs.writeFileSync(charactersPath, JSON.stringify(characters, null, 2));
    }

    // Delete animation config from characters.json
    deleteAnimationConfig(name) {
        const charactersPath = path.join(__dirname, 'characters.json');
        const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
        delete characters[name];
        fs.writeFileSync(charactersPath, JSON.stringify(characters, null, 2));
    }

    // Rename animation config in characters.json
    renameAnimationConfig(oldName, newName) {
        const charactersPath = path.join(__dirname, 'characters.json');
        const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
        if (characters[oldName]) {
            characters[newName] = characters[oldName];
            delete characters[oldName];
            fs.writeFileSync(charactersPath, JSON.stringify(characters, null, 2));
        }
    }
}

module.exports = CharacterStore;
