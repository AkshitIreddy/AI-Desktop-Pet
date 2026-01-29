const { app, BrowserWindow, screen, Menu, Tray, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const CharacterStore = require('./characterStore');

const characterStore = new CharacterStore();

// Add this block for auto-reloading
try {
  require('electron-reloader')(module, {
    debug: true,
    watchRenderer: true
  });
} catch (err) { 
  console.error('Failed to load electron-reloader:', err);
}

// Add this CSP configuration at the top of the file with other constants
const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "connect-src 'self' https://api.convai.com wss://webstream.convai.com",
    "media-src 'self' blob: data:",
    "worker-src blob:",
    "script-src-elem 'self' 'unsafe-eval'"
].join('; ');

let petWindows = new Map();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    }
  })

  // Add handler for close button
  mainWindow.on('close', function(event) {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives]
      }
    })
  })

  mainWindow.loadFile('index.html')

  // Remove the default menu
  Menu.setApplicationMenu(null)
}

function createPet(name) {
  if (!name) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const taskbarHeight = height - screen.getPrimaryDisplay().workAreaSize.height;
  const taskbarGap = taskbarHeight + 1;  // Increased gap when above taskbar is true

  const petWindow = new BrowserWindow({
    width: width,
    height: height - taskbarGap,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  petWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives]
      }
    })
  })

  petWindow.loadFile('pet.html', { query: { character: name } })
  
  petWindow.setIgnoreMouseEvents(true, { forward: true })

  petWindow.webContents.on('ipc-message', (event, channel, ...args) => {
    if (channel === 'set-ignore-mouse-events') {
      petWindow.setIgnoreMouseEvents(...args)
    } else if (channel === 'set-window-focusable') {
      petWindow.setFocusable(args[0]);
    }
  })

  petWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[${name}]: ${message}`);
  })

  // Send settings to pet window after it loads
  petWindow.webContents.on('did-finish-load', () => {
    const settings = characterStore.getSettings();
    petWindow.webContents.send('settings-updated', settings);
  });

  petWindows.set(name, petWindow);
}

let tray;
function createTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'))
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      } 
    }
  ])
  tray.setToolTip('Convai Desktop Pet')
  tray.setContextMenu(contextMenu)
  
  // Optional: Add double-click handler to show window
  tray.on('double-click', () => {
    mainWindow.show();
  });
}

app.whenReady().then(async () => {
  try {
    await characterStore.initializeStore();
    createWindow();
    createTray();

    const characters = characterStore.getAllCharacters();
    for (const [name, data] of Object.entries(characters)) {
      if (data.spawn) {
        createPet(name);
      }
    }

    ipcMain.on('get-characters', (event) => {
      const characters = characterStore.getAllCharacters();
      event.reply('characters', characters);
    });

    ipcMain.on('update-spawn', (event, name, spawn) => {
      characterStore.setCharacterSpawn(name, spawn);
      if (spawn) {
        createPet(name);
      } else {
        closePet(name);
      }
    });

    ipcMain.on('update-character-id', (event, name, newId) => {
      characterStore.setCharacterId(name, newId);
      characterStore.setCharacterSessionId(name, "-1");
      event.reply('characters', characterStore.getAllCharacters());
      closePet(name);
      createPet(name);
    });

    ipcMain.on('get-api-key', (event) => {
      const apiKey = characterStore.getApiKey();
      event.reply('api-key', apiKey);
    });

    ipcMain.on('update-api-key', (event, newKey) => {
      characterStore.setApiKey(newKey);
      for (const [name, petWindow] of petWindows.entries()) {
        if (!petWindow.isDestroyed()) {
          petWindow.webContents.send('api-key-updated', newKey);
        }
      }
    });

    ipcMain.on('get-character-config', (event, characterName) => {
      const characters = characterStore.getAllCharacters();
      const character = characters[characterName];
      const apiKey = characterStore.getApiKey();
      
      event.reply('character-config', {
        characterId: character.id,
        apiKey: apiKey,
        sessionId: character.session_id
      });
    });

    ipcMain.on('update-session-id', (event, characterName, sessionId) => {
      characterStore.setCharacterSessionId(characterName, sessionId);
    });

    ipcMain.on('get-settings', (event) => {
      const settings = characterStore.getSettings();
      event.reply('settings', settings);
    });

    ipcMain.on('update-settings', (event, settings) => {
      characterStore.updateSettings(settings);
      // Instead of closing and recreating, send a settings update to existing windows
      for (const [name, petWindow] of petWindows.entries()) {
        if (!petWindow.isDestroyed()) {
          petWindow.webContents.send('settings-updated', settings);
        }
      }
    });

    // Rename character handler
    ipcMain.on('rename-character', async (event, oldName, newName) => {
      try {
        // Check if pet is currently spawned - close it first
        const wasSpawned = characterStore.getCharacterSpawn(oldName);
        if (wasSpawned) {
          closePet(oldName);
        }

        // Rename in store
        const result = characterStore.renameCharacter(oldName, newName);
        
        if (result.renamed) {
          // Rename the assets folder
          const oldPath = path.join(__dirname, 'assets', oldName);
          const newPath = path.join(__dirname, 'assets', result.newName);
          
          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
          }

          // Rename in characters.json
          characterStore.renameAnimationConfig(oldName, result.newName);

          // If was spawned, respawn with new name
          if (wasSpawned) {
            characterStore.setCharacterSpawn(result.newName, true);
            createPet(result.newName);
          }
        }

        event.reply('rename-character-result', { success: true, oldName, newName: result.newName });
        event.reply('characters', characterStore.getAllCharacters());
      } catch (error) {
        event.reply('rename-character-result', { success: false, error: error.message });
      }
    });

    // Add new character handler
    ipcMain.on('add-character', async (event, characterData) => {
      try {
        const { name, characterId, animationConfig, assets } = characterData;
        
        // Add to store
        const sanitizedName = characterStore.addCharacter(name, characterId, animationConfig);
        
        // Create assets folder
        const assetsPath = path.join(__dirname, 'assets', sanitizedName);
        if (!fs.existsSync(assetsPath)) {
          fs.mkdirSync(assetsPath, { recursive: true });
        }

        // Save uploaded assets
        for (const [filename, base64Data] of Object.entries(assets)) {
          const filePath = path.join(assetsPath, filename);
          const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
          fs.writeFileSync(filePath, buffer);
        }

        // Save animation config to characters.json
        characterStore.saveAnimationConfig(sanitizedName, animationConfig);

        event.reply('add-character-result', { success: true, name: sanitizedName });
        event.reply('characters', characterStore.getAllCharacters());
      } catch (error) {
        event.reply('add-character-result', { success: false, error: error.message });
      }
    });

    // Delete character handler
    ipcMain.on('delete-character', async (event, name) => {
      try {
        // Close pet if spawned
        if (characterStore.getCharacterSpawn(name)) {
          closePet(name);
        }

        // Delete from store
        characterStore.deleteCharacter(name);

        // Delete from characters.json
        characterStore.deleteAnimationConfig(name);

        // Delete assets folder
        const assetsPath = path.join(__dirname, 'assets', name);
        if (fs.existsSync(assetsPath)) {
          fs.rmSync(assetsPath, { recursive: true, force: true });
        }

        event.reply('delete-character-result', { success: true, name });
        event.reply('characters', characterStore.getAllCharacters());
      } catch (error) {
        event.reply('delete-character-result', { success: false, error: error.message });
      }
    });

    // Archive/unarchive character handler
    ipcMain.on('archive-character', (event, name, archived) => {
      try {
        // Close pet if spawned and archiving
        if (archived && characterStore.getCharacterSpawn(name)) {
          closePet(name);
        }

        characterStore.setCharacterArchived(name, archived);
        event.reply('archive-character-result', { success: true, name, archived });
        event.reply('characters', characterStore.getAllCharacters());
      } catch (error) {
        event.reply('archive-character-result', { success: false, error: error.message });
      }
    });

    // Check if character is user-added
    ipcMain.on('is-user-added', (event, name) => {
      const isUserAdded = characterStore.isUserAddedCharacter(name);
      event.reply('is-user-added-result', { name, isUserAdded });
    });

    // Get animation config for a character
    ipcMain.on('get-animation-config', (event, name) => {
      const config = characterStore.getAnimationConfig(name);
      event.reply('animation-config', { name, config });
    });
  } catch (error) {
    console.error('Failed to initialize the app:', error);
    dialog.showErrorBox('Initialization Error', 'Failed to start the application. Please try restarting.');
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function closePet(name) {
  const petWindow = petWindows.get(name);
  if (petWindow) {
    petWindow.close();
    petWindows.delete(name);
  }
}

