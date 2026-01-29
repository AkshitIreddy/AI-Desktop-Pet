const { ipcRenderer, shell } = require('electron');

// Cached DOM element references for performance
let cachedElements = {};

function getCachedElement(id) {
    if (!cachedElements[id]) {
        cachedElements[id] = document.getElementById(id);
    }
    return cachedElements[id];
}

document.addEventListener('DOMContentLoaded', () => {
    // Cache frequently used elements
    cachedElements = {
        'character-list': document.getElementById('character-list'),
        'archived-characters-list': document.getElementById('archived-characters-list'),
        'frame-duration': document.getElementById('frame-duration'),
        'move-duration': document.getElementById('move-duration'),
        'save-settings': document.getElementById('save-settings'),
        'api-key-button': document.getElementById('api-key-button'),
        'create-character-btn': document.getElementById('create-character-btn')
    };

    // Cache page elements
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    const colorOptions = document.querySelectorAll('.color-option');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Use cached pages instead of querying again
            navItems.forEach(i => i.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            
            item.classList.add('active');
            const page = item.getAttribute('data-page');
            document.getElementById(`${page}-page`).classList.add('active');
        });
    });

    // Original get-characters code
    ipcRenderer.send('get-characters');

    // Load settings
    ipcRenderer.send('get-settings');

    // Add this new event listener
    document.addEventListener('click', (event) => {
        if (event.target.tagName === 'A' && event.target.classList.contains('external-link')) {
            event.preventDefault();
            shell.openExternal(event.target.href);
        }
    });

    // Setup color picker event listeners once (moved from bottom)
    colorOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            currentAccentColor = color;
            applyAccentColor(color);
            
            // Update selection visual
            colorOptions.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
});

document.getElementById('api-key-button').addEventListener('click', () => {
    createApiKeyPopup();
});

function createApiKeyPopup() {
    // Create popup elements
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';

    const content = document.createElement('div');
    content.className = 'popup-content';

    const header = document.createElement('div');
    header.className = 'popup-header';

    const title = document.createElement('h3');
    title.textContent = 'API Key Configuration';

    const closeButton = document.createElement('span');
    closeButton.textContent = '\u00D7';
    closeButton.className = 'popup-close';
    closeButton.onclick = () => overlay.remove();

    // Assemble the popup
    header.appendChild(title);
    header.appendChild(closeButton);
    content.appendChild(header);

    // Add current API key display
    const currentKeyDisplay = document.createElement('p');
    currentKeyDisplay.className = 'current-id';
    currentKeyDisplay.textContent = 'Current API Key: ';
    content.appendChild(currentKeyDisplay);

    // Create form for API key input
    const form = document.createElement('div');
    form.innerHTML = `
        <div class="id-edit-container">
            <label for="api-key">New API Key:</label>
            <input type="text" id="api-key-input" class="id-input">
            <button id="update-api-key" class="update-button">
                Update API Key
            </button>
        </div>
    `;
    content.appendChild(form);

    // Add event listener for the update button
    requestAnimationFrame(() => {
        const updateButton = document.getElementById('update-api-key');
        const keyInput = document.getElementById('api-key-input');
        
        // Get current API key
        ipcRenderer.send('get-api-key');
        
        ipcRenderer.once('api-key', (event, apiKey) => {
            currentKeyDisplay.textContent = `Current API Key: ${apiKey || 'Not set'}`;
            keyInput.value = apiKey || '';
        });

        updateButton.addEventListener('click', () => {
            const newKey = keyInput.value;
            ipcRenderer.send('update-api-key', newKey);
            overlay.remove();
        });
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // Show the popup with a fade effect
    requestAnimationFrame(() => {
        overlay.style.display = 'flex';
    });
}

// Load animation configs synchronously to ensure they're available before rendering
let animationConfigs = {};
try {
    // Use require for synchronous loading in Electron's Node context
    animationConfigs = require('./characters.json');
} catch (error) {
    console.error('Failed to load animation configs:', error);
}

// Function to reload animation configs (called after adding new characters)
function reloadAnimationConfigs() {
    try {
        // Clear require cache to get fresh data
        delete require.cache[require.resolve('./characters.json')];
        animationConfigs = require('./characters.json');
    } catch (error) {
        console.error('Failed to reload animation configs:', error);
    }
}

// Store for animation intervals to clean up
let previewIntervals = [];
let previewsPaused = false;

function cleanupPreviewAnimations() {
    previewIntervals.forEach(interval => clearInterval(interval));
    previewIntervals = [];
}

// Pause/resume previews when tab visibility changes
document.addEventListener('visibilitychange', () => {
    previewsPaused = document.hidden;
});

function createAnimatedPreview(characterName, imgElement) {
    const config = animationConfigs[characterName];
    if (!config) {
        imgElement.src = `assets/${characterName}/walk1.png`;
        return;
    }

    // Gather all available animations in order: idle first, then special
    const animations = [];
    
    // Add idle actions first (sorted by action number)
    if (config.idle_actions) {
        const idleKeys = Object.keys(config.idle_actions).sort();
        idleKeys.forEach(key => {
            const action = config.idle_actions[key];
            const actionNum = key.replace('idle_action_', '');
            animations.push({
                type: 'idle',
                prefix: `id${actionNum}_`,
                maxFrames: action.max_frames,
                loopTimes: Math.min(action.loop_times || 3, 3)
            });
        });
    }
    
    // Add special actions second (sorted by action number)
    if (config.special_actions) {
        const specialKeys = Object.keys(config.special_actions).sort();
        specialKeys.forEach(key => {
            const action = config.special_actions[key];
            const actionNum = key.replace('special_action_', '');
            animations.push({
                type: 'special',
                prefix: `sp${actionNum}_`,
                maxFrames: action.max_frames,
                loopTimes: Math.min(action.loop_times || 3, 3)
            });
        });
    }

    // If no animations available, show walk frame
    if (animations.length === 0) {
        imgElement.src = `assets/${characterName}/walk1.png`;
        return;
    }

    // Animation state - play in sequence
    let currentAnimIndex = 0;
    let currentFrame = 1;
    let loopCount = 0;
    
    // Set initial frame
    imgElement.src = `assets/${characterName}/${animations[0].prefix}${currentFrame}.png`;
    
    // Create animation loop - pauses when tab is hidden
    const interval = setInterval(() => {
        // Skip updates when tab is not visible
        if (previewsPaused) return;
        
        const currentAnim = animations[currentAnimIndex];
        currentFrame++;
        
        if (currentFrame > currentAnim.maxFrames) {
            loopCount++;
            if (loopCount >= currentAnim.loopTimes) {
                currentAnimIndex = (currentAnimIndex + 1) % animations.length;
                loopCount = 0;
            }
            currentFrame = 1;
        }
        
        imgElement.src = `assets/${characterName}/${animations[currentAnimIndex].prefix}${currentFrame}.png`;
    }, 200);
    
    previewIntervals.push(interval);
}

ipcRenderer.on('characters', (event, characters) => {
    const characterList = getCachedElement('character-list');
    const archivedList = getCachedElement('archived-characters-list');
    
    // Cleanup existing animations
    cleanupPreviewAnimations();
    
    // Use replaceChildren for cleaner DOM clearing
    if (characterList) characterList.replaceChildren();
    if (archivedList) archivedList.replaceChildren();

    // Separate archived and active characters
    const activeChars = [];
    const archivedChars = [];
    
    for (const [name, data] of Object.entries(characters)) {
        if (data.archived) {
            archivedChars.push({ name, data });
        } else {
            activeChars.push({ name, data });
        }
    }

    // Render archived characters in settings using DocumentFragment
    if (archivedList && archivedChars.length > 0) {
        const archivedFragment = document.createDocumentFragment();
        archivedChars.forEach(({ name, data }) => {
            const item = document.createElement('div');
            item.className = 'archived-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'archived-name';
            nameSpan.textContent = name.charAt(0).toUpperCase() + name.slice(1);
            
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'restore-button';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', () => {
                ipcRenderer.send('archive-character', name, false);
            });
            
            item.appendChild(nameSpan);
            item.appendChild(restoreBtn);
            archivedFragment.appendChild(item);
        });
        archivedList.appendChild(archivedFragment);
    } else if (archivedList) {
        const noArchived = document.createElement('p');
        noArchived.className = 'no-archived';
        noArchived.textContent = 'No archived characters';
        archivedList.appendChild(noArchived);
    }

    // Render active characters using DocumentFragment
    const charFragment = document.createDocumentFragment();
    for (const { name, data } of activeChars) {

        // Create card container
        const card = document.createElement('div');
        card.className = 'character-card';

        // Create button container for top-right buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'card-button-container';

        // Add archive button (available for all characters)
        const archiveButton = document.createElement('button');
        archiveButton.className = 'card-icon-button archive-button';
        archiveButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>';
        archiveButton.title = 'Archive character';
        archiveButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Archive "${name}"? You can restore it later from Settings.`)) {
                ipcRenderer.send('archive-character', name, true);
            }
        });

        // Add delete button (only for user-added characters)
        if (data.isUserAdded) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'card-icon-button delete-button';
            deleteButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            deleteButton.title = 'Delete character';
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
                    ipcRenderer.send('delete-character', name);
                }
            });
            buttonContainer.appendChild(deleteButton);
        }

        // Add rename button
        const renameButton = document.createElement('button');
        renameButton.className = 'card-icon-button rename-button';
        renameButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
        renameButton.title = 'Rename character';
        renameButton.addEventListener('click', (e) => {
            e.stopPropagation();
            createRenamePopup(name);
        });

        // Add edit button (for character ID)
        const editButton = document.createElement('button');
        editButton.className = 'card-icon-button edit-id-button';
        editButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
        editButton.title = 'Edit character ID';
        editButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const characterId = data.id;
            createPopup(name, characterId);
        });

        buttonContainer.appendChild(archiveButton);
        buttonContainer.appendChild(renameButton);
        buttonContainer.appendChild(editButton);

        // Add character image with animated preview
        const image = document.createElement('img');
        image.alt = name;
        image.className = 'character-image';
        
        // Start animated preview
        createAnimatedPreview(name, image);

        // Create info container
        const info = document.createElement('div');
        info.className = 'character-info';

        // Add character name
        const nameElement = document.createElement('h3');
        nameElement.textContent = name.charAt(0).toUpperCase() + name.slice(1);

        // Create spawn toggle container with modern toggle switch
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'toggle-container';

        const toggleLabel = document.createElement('span');
        toggleLabel.className = 'toggle-label';
        toggleLabel.textContent = data.spawn ? 'Active' : 'Inactive';

        const toggleWrapper = document.createElement('label');
        toggleWrapper.className = 'toggle-switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `spawn-${name}`;
        checkbox.checked = data.spawn;
        checkbox.addEventListener('change', () => {
            // Update label text when toggled
            toggleLabel.textContent = checkbox.checked ? 'Active' : 'Inactive';
            ipcRenderer.send('update-spawn', name, checkbox.checked);
        });

        const slider = document.createElement('span');
        slider.className = 'toggle-slider';

        toggleWrapper.appendChild(checkbox);
        toggleWrapper.appendChild(slider);

        // Assemble the card
        toggleContainer.appendChild(toggleLabel);
        toggleContainer.appendChild(toggleWrapper);

        info.appendChild(nameElement);
        info.appendChild(toggleContainer);

        card.appendChild(buttonContainer);
        card.appendChild(image);
        card.appendChild(info);
        
        charFragment.appendChild(card);
    }
    
    // Append all cards at once for better performance
    if (characterList) {
        characterList.appendChild(charFragment);
    }
});

function createPopup(characterName, characterId) {
    // Create popup elements
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';

    const content = document.createElement('div');
    content.className = 'popup-content';

    const header = document.createElement('div');
    header.className = 'popup-header';

    const title = document.createElement('h3');
    title.textContent = 'Character ID Configuration';

    const closeButton = document.createElement('span');
    closeButton.textContent = '\u00D7';
    closeButton.className = 'popup-close';
    closeButton.onclick = () => overlay.remove();

    // Assemble the popup
    header.appendChild(title);
    header.appendChild(closeButton);
    content.appendChild(header);

    // Add ID display before the form
    const idDisplay = document.createElement('p');
    idDisplay.className = 'current-id';
    idDisplay.textContent = `Current ID: ${characterId}`;
    content.appendChild(idDisplay);

    // Create form for ID input
    const form = document.createElement('div');
    form.innerHTML = `
        <div class="id-edit-container">
            <label for="character-id">New Character ID:</label>
            <input type="text" id="character-id-${characterName}" class="id-input">
            <button id="update-id-${characterName}" class="update-button">
                Update ID
            </button>
        </div>
    `;
    content.appendChild(form);

    // Add event listener for the update button
    requestAnimationFrame(() => {
        const updateButton = document.getElementById(`update-id-${characterName}`);
        const idInput = document.getElementById(`character-id-${characterName}`);
        
        // Set initial value to the current ID
        idInput.value = characterId;

        updateButton.addEventListener('click', () => {
            const newId = idInput.value;
            ipcRenderer.send('update-character-id', characterName, newId);
            overlay.remove();
        });
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // Show the popup with a fade effect
    requestAnimationFrame(() => {
        overlay.style.display = 'flex';
    });
}

// Rename character popup
function createRenamePopup(characterName) {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';

    const content = document.createElement('div');
    content.className = 'popup-content';

    const header = document.createElement('div');
    header.className = 'popup-header';

    const title = document.createElement('h3');
    title.textContent = 'Rename Character';

    const closeButton = document.createElement('span');
    closeButton.textContent = '\u00D7';
    closeButton.className = 'popup-close';
    closeButton.onclick = () => overlay.remove();

    header.appendChild(title);
    header.appendChild(closeButton);
    content.appendChild(header);

    const currentNameDisplay = document.createElement('p');
    currentNameDisplay.className = 'current-id';
    currentNameDisplay.textContent = `Current Name: ${characterName.charAt(0).toUpperCase() + characterName.slice(1)}`;
    content.appendChild(currentNameDisplay);

    const form = document.createElement('div');
    form.innerHTML = `
        <div class="id-edit-container">
            <label for="new-name-${characterName}">New Name:</label>
            <input type="text" id="new-name-${characterName}" class="id-input" value="${characterName}">
            <button id="rename-btn-${characterName}" class="update-button">Rename</button>
        </div>
        <p class="help-text">Use only letters, numbers, underscores, and hyphens.</p>
    `;
    content.appendChild(form);

    requestAnimationFrame(() => {
        const renameButton = document.getElementById(`rename-btn-${characterName}`);
        const nameInput = document.getElementById(`new-name-${characterName}`);

        renameButton.addEventListener('click', () => {
            const newName = nameInput.value.trim();
            if (newName) {
                ipcRenderer.send('rename-character', characterName, newName);
                overlay.remove();
            }
        });

        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                renameButton.click();
            }
        });
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.display = 'flex';
    });
}

// Listen for rename result
ipcRenderer.on('rename-character-result', (event, result) => {
    if (!result.success) {
        alert(`Failed to rename character: ${result.error}`);
    }
});

// Character creation wizard
function openCharacterCreationWizard() {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay wizard-overlay';

    const content = document.createElement('div');
    content.className = 'popup-content wizard-content';

    let currentStep = 1;
    const totalSteps = 3;
    
    // Store collected data
    const characterData = {
        name: '',
        characterId: '',
        assets: {},
        animationConfig: {
            character_id: '',
            walk_max_frame: 3,
            drag_max_frames: 6,
            fall_max_frames: 5,
            climb_max_frames: 3,
            special_actions: {},
            idle_actions: {}
        }
    };

    function renderStep() {
        content.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.className = 'popup-header';

        const title = document.createElement('h3');
        title.textContent = `Create New Character - Step ${currentStep}/${totalSteps}`;

        const closeButton = document.createElement('span');
        closeButton.textContent = '\u00D7';
        closeButton.className = 'popup-close';
        closeButton.onclick = () => overlay.remove();

        header.appendChild(title);
        header.appendChild(closeButton);
        content.appendChild(header);

        // Step content
        const stepContent = document.createElement('div');
        stepContent.className = 'wizard-step-content';

        if (currentStep === 1) {
            // Step 1: Basic info
            stepContent.innerHTML = `
                <div class="wizard-form">
                    <div class="form-group">
                        <label for="char-name">Character Name:</label>
                        <input type="text" id="char-name" class="id-input" placeholder="e.g., mycharacter" value="${characterData.name}">
                        <p class="help-text">Use only letters, numbers, underscores, and hyphens.</p>
                    </div>
                    <div class="form-group">
                        <label for="char-id">Convai Character ID:</label>
                        <input type="text" id="char-id" class="id-input" placeholder="Enter Convai character ID" value="${characterData.characterId}">
                        <p class="help-text">Get this from your Convai dashboard.</p>
                    </div>
                </div>
            `;
        } else if (currentStep === 2) {
            // Step 2: Required assets
            stepContent.innerHTML = `
                <div class="wizard-form">
                    <h4>Required Animation Frames</h4>
                    <p class="help-text">Upload PNG images for each animation type.</p>
                    
                    <div class="asset-upload-section">
                        <h5>Walk Animation (3 frames)</h5>
                        <div class="upload-grid" id="walk-uploads">
                            ${createUploadInputs('walk', 3)}
                        </div>
                    </div>
                    
                    <div class="asset-upload-section">
                        <h5>Climb Animation (3 frames)</h5>
                        <div class="upload-grid" id="climb-uploads">
                            ${createUploadInputs('climb', 3)}
                        </div>
                    </div>
                    
                    <div class="asset-upload-section">
                        <h5>Fall Animation (5 frames)</h5>
                        <div class="upload-grid" id="fall-uploads">
                            ${createUploadInputs('fall', 5)}
                        </div>
                    </div>
                    
                    <div class="asset-upload-section">
                        <h5>Drag Animation (6 frames)</h5>
                        <div class="upload-grid" id="drag-uploads">
                            ${createUploadInputs('drag', 6)}
                        </div>
                    </div>
                </div>
            `;
        } else if (currentStep === 3) {
            // Step 3: Optional assets
            stepContent.innerHTML = `
                <div class="wizard-form">
                    <h4>Optional Animations</h4>
                    <p class="help-text">Add idle and special animations (optional).</p>
                    
                    <div class="optional-section">
                        <h5>Idle Actions</h5>
                        <div id="idle-actions-container">
                            <div class="idle-action-group" data-action="1">
                                <label>Idle Action 1:</label>
                                <div class="upload-row">
                                    <input type="file" accept="image/png" class="file-input" data-type="id1_1">
                                    <span class="file-name">id1_1.png</span>
                                </div>
                            </div>
                            <div class="idle-action-group" data-action="2">
                                <label>Idle Action 2:</label>
                                <div class="upload-row">
                                    <input type="file" accept="image/png" class="file-input" data-type="id2_1">
                                    <span class="file-name">id2_1.png</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="optional-section">
                        <h5>Special Actions</h5>
                        <div id="special-actions-container">
                            <div class="special-action-group" data-action="1">
                                <label>Special Action 1 (frames):</label>
                                <input type="number" class="frame-count-input" id="sp1-frames" min="1" max="10" value="1">
                                <div class="upload-row special-frames" id="sp1-uploads"></div>
                            </div>
                        </div>
                        <button type="button" id="add-special-action" class="add-action-btn">+ Add Special Action</button>
                    </div>
                    
                    <div class="preview-section">
                        <h5>Summary</h5>
                        <p>Character Name: <strong>${characterData.name}</strong></p>
                        <p>Character ID: <strong>${characterData.characterId}</strong></p>
                        <p>Assets uploaded: <strong>${Object.keys(characterData.assets).length}</strong></p>
                    </div>
                </div>
            `;
        }

        content.appendChild(stepContent);

        // Navigation buttons
        const navButtons = document.createElement('div');
        navButtons.className = 'wizard-nav-buttons';

        if (currentStep > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'update-button';
            prevBtn.textContent = 'Previous';
            prevBtn.onclick = () => {
                currentStep--;
                renderStep();
            };
            navButtons.appendChild(prevBtn);
        }

        if (currentStep < totalSteps) {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'update-button primary-button';
            nextBtn.textContent = 'Next';
            nextBtn.onclick = () => {
                if (validateStep()) {
                    saveStepData();
                    currentStep++;
                    renderStep();
                }
            };
            navButtons.appendChild(nextBtn);
        } else {
            const createBtn = document.createElement('button');
            createBtn.className = 'update-button primary-button';
            createBtn.textContent = 'Create Character';
            createBtn.onclick = () => {
                if (validateStep()) {
                    saveStepData();
                    submitCharacter();
                }
            };
            navButtons.appendChild(createBtn);
        }

        content.appendChild(navButtons);

        // Setup event listeners after render
        requestAnimationFrame(() => {
            setupStepListeners();
        });
    }

    function createUploadInputs(type, count) {
        let html = '';
        for (let i = 1; i <= count; i++) {
            const filename = `${type}${i}.png`;
            const hasFile = characterData.assets[filename];
            html += `
                <div class="upload-item ${hasFile ? 'has-file' : ''}">
                    <input type="file" accept="image/png" class="file-input" data-type="${type}${i}" id="file-${type}${i}">
                    <label for="file-${type}${i}" class="upload-label">${hasFile ? '✓' : '+'}</label>
                    <span class="file-name">${filename}</span>
                </div>
            `;
        }
        return html;
    }

    function setupStepListeners() {
        // File input listeners
        document.querySelectorAll('.file-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const dataType = e.target.getAttribute('data-type');
                        characterData.assets[`${dataType}.png`] = event.target.result;
                        
                        // Update UI
                        const uploadItem = e.target.closest('.upload-item');
                        if (uploadItem) {
                            uploadItem.classList.add('has-file');
                            uploadItem.querySelector('.upload-label').textContent = '✓';
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        });

        // Special action frame count listener
        const sp1Frames = document.getElementById('sp1-frames');
        if (sp1Frames) {
            updateSpecialActionUploads(1, parseInt(sp1Frames.value) || 1);
            sp1Frames.addEventListener('change', (e) => {
                updateSpecialActionUploads(1, parseInt(e.target.value) || 1);
            });
        }

        // Add special action button
        const addSpecialBtn = document.getElementById('add-special-action');
        if (addSpecialBtn) {
            addSpecialBtn.addEventListener('click', addSpecialAction);
        }
    }

    let specialActionCount = 1;

    function addSpecialAction() {
        specialActionCount++;
        const container = document.getElementById('special-actions-container');
        const newAction = document.createElement('div');
        newAction.className = 'special-action-group';
        newAction.setAttribute('data-action', specialActionCount);
        newAction.innerHTML = `
            <label>Special Action ${specialActionCount} (frames):</label>
            <input type="number" class="frame-count-input" id="sp${specialActionCount}-frames" min="1" max="10" value="1">
            <div class="upload-row special-frames" id="sp${specialActionCount}-uploads"></div>
        `;
        container.appendChild(newAction);

        const framesInput = document.getElementById(`sp${specialActionCount}-frames`);
        const actionNum = specialActionCount;
        updateSpecialActionUploads(actionNum, 1);
        framesInput.addEventListener('change', (e) => {
            updateSpecialActionUploads(actionNum, parseInt(e.target.value) || 1);
        });
    }

    function updateSpecialActionUploads(actionNum, frameCount) {
        const uploadsContainer = document.getElementById(`sp${actionNum}-uploads`);
        if (!uploadsContainer) return;

        let html = '';
        for (let i = 1; i <= frameCount; i++) {
            const filename = `sp${actionNum}_${i}.png`;
            const hasFile = characterData.assets[filename];
            html += `
                <div class="upload-item ${hasFile ? 'has-file' : ''}">
                    <input type="file" accept="image/png" class="file-input" data-type="sp${actionNum}_${i}" id="file-sp${actionNum}_${i}">
                    <label for="file-sp${actionNum}_${i}" class="upload-label">${hasFile ? '✓' : '+'}</label>
                    <span class="file-name">${filename}</span>
                </div>
            `;
        }
        uploadsContainer.innerHTML = html;

        // Re-attach listeners
        uploadsContainer.querySelectorAll('.file-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const dataType = e.target.getAttribute('data-type');
                        characterData.assets[`${dataType}.png`] = event.target.result;
                        
                        const uploadItem = e.target.closest('.upload-item');
                        if (uploadItem) {
                            uploadItem.classList.add('has-file');
                            uploadItem.querySelector('.upload-label').textContent = '✓';
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        });
    }

    function validateStep() {
        if (currentStep === 1) {
            const name = document.getElementById('char-name').value.trim();
            const charId = document.getElementById('char-id').value.trim();
            
            if (!name) {
                alert('Please enter a character name.');
                return false;
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
                alert('Character name can only contain letters, numbers, underscores, and hyphens.');
                return false;
            }
            if (!charId) {
                alert('Please enter a Convai character ID.');
                return false;
            }
            return true;
        } else if (currentStep === 2) {
            // Check required assets
            const requiredAssets = [
                'walk1.png', 'walk2.png', 'walk3.png',
                'climb1.png', 'climb2.png', 'climb3.png',
                'fall1.png', 'fall2.png', 'fall3.png', 'fall4.png', 'fall5.png',
                'drag1.png', 'drag2.png', 'drag3.png', 'drag4.png', 'drag5.png', 'drag6.png'
            ];
            
            const missingAssets = requiredAssets.filter(asset => !characterData.assets[asset]);
            if (missingAssets.length > 0) {
                alert(`Please upload all required assets. Missing: ${missingAssets.slice(0, 5).join(', ')}${missingAssets.length > 5 ? '...' : ''}`);
                return false;
            }
            return true;
        }
        return true;
    }

    function saveStepData() {
        if (currentStep === 1) {
            characterData.name = document.getElementById('char-name').value.trim().toLowerCase();
            characterData.characterId = document.getElementById('char-id').value.trim();
            characterData.animationConfig.character_id = characterData.characterId;
        } else if (currentStep === 3) {
            // Process idle actions
            const idleActions = {};
            document.querySelectorAll('.idle-action-group').forEach(group => {
                const actionNum = group.getAttribute('data-action');
                const fileInput = group.querySelector('.file-input');
                if (fileInput && characterData.assets[`id${actionNum}_1.png`]) {
                    idleActions[`idle_action_${actionNum}`] = {
                        max_frames: 1,
                        loop: true,
                        loop_times: 10,
                        description: `Idle action ${actionNum}`
                    };
                }
            });
            characterData.animationConfig.idle_actions = idleActions;

            // Process special actions
            const specialActions = {};
            document.querySelectorAll('.special-action-group').forEach(group => {
                const actionNum = group.getAttribute('data-action');
                const framesInput = document.getElementById(`sp${actionNum}-frames`);
                const frameCount = parseInt(framesInput?.value) || 1;
                
                // Check if at least one frame is uploaded
                let hasFrames = false;
                for (let i = 1; i <= frameCount; i++) {
                    if (characterData.assets[`sp${actionNum}_${i}.png`]) {
                        hasFrames = true;
                        break;
                    }
                }
                
                if (hasFrames) {
                    specialActions[`special_action_${actionNum}`] = {
                        max_frames: frameCount,
                        loop: true,
                        loop_times: 5,
                        description: `Special action ${actionNum}`
                    };
                }
            });
            characterData.animationConfig.special_actions = specialActions;
        }
    }

    function submitCharacter() {
        ipcRenderer.send('add-character', {
            name: characterData.name,
            characterId: characterData.characterId,
            animationConfig: characterData.animationConfig,
            assets: characterData.assets
        });
        overlay.remove();
    }

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.display = 'flex';
        renderStep();
    });
}

// Listen for add character result
ipcRenderer.on('add-character-result', (event, result) => {
    if (result.success) {
        // Reload animation configs
        reloadAnimationConfigs();
    } else {
        alert(`Failed to create character: ${result.error}`);
    }
});

// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Apply accent color to CSS variables
function applyAccentColor(color) {
    const rgb = hexToRgb(color);
    if (rgb) {
        document.documentElement.style.setProperty('--accent-color', color);
        document.documentElement.style.setProperty('--accent-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    }
}

// Track current settings
let currentAccentColor = '#ec4899';
let currentPetSize = 100;
let currentPetOpacity = 100;
let currentAnimationSpeed = 1.0;

// Update slider display value
function updateSliderDisplay(sliderId, value, suffix = '') {
    const display = document.getElementById(`${sliderId}-value`);
    if (display) display.textContent = value + suffix;
}

// Add settings listeners - use cached elements
ipcRenderer.on('settings', (event, settings) => {
    const frameDuration = getCachedElement('frame-duration');
    const moveDuration = getCachedElement('move-duration');
    
    if (frameDuration) frameDuration.value = settings.defaultFrameDuration;
    if (moveDuration) moveDuration.value = settings.defaultMoveDuration;
    
    // Apply accent color
    if (settings.accentColor) {
        currentAccentColor = settings.accentColor;
        applyAccentColor(settings.accentColor);
        
        document.querySelectorAll('.color-option').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.color === settings.accentColor);
        });
    }
    
    // Apply pet customization settings
    const petSizeSlider = document.getElementById('pet-size');
    const petOpacitySlider = document.getElementById('pet-opacity');
    const animSpeedSlider = document.getElementById('animation-speed');
    
    if (settings.petSize !== undefined) {
        currentPetSize = settings.petSize;
        if (petSizeSlider) petSizeSlider.value = settings.petSize;
        updateSliderDisplay('pet-size', settings.petSize, '%');
    }
    if (settings.petOpacity !== undefined) {
        currentPetOpacity = settings.petOpacity;
        if (petOpacitySlider) petOpacitySlider.value = settings.petOpacity;
        updateSliderDisplay('pet-opacity', settings.petOpacity, '%');
    }
    if (settings.animationSpeed !== undefined) {
        currentAnimationSpeed = settings.animationSpeed;
        if (animSpeedSlider) animSpeedSlider.value = settings.animationSpeed;
        updateSliderDisplay('animation-speed', settings.animationSpeed.toFixed(1), 'x');
    }
});

// Save settings button - setup after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = getCachedElement('save-settings');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const frameDuration = getCachedElement('frame-duration');
            const moveDuration = getCachedElement('move-duration');
            
            const settings = {
                defaultFrameDuration: parseInt(frameDuration?.value || 200),
                defaultMoveDuration: parseInt(moveDuration?.value || 12),
                accentColor: currentAccentColor,
                petSize: currentPetSize,
                petOpacity: currentPetOpacity,
                animationSpeed: currentAnimationSpeed
            };
            ipcRenderer.send('update-settings', settings);
        });
    }

    const createCharBtn = getCachedElement('create-character-btn');
    if (createCharBtn) {
        createCharBtn.addEventListener('click', openCharacterCreationWizard);
    }
    
    // Setup slider event listeners
    const petSizeSlider = document.getElementById('pet-size');
    const petOpacitySlider = document.getElementById('pet-opacity');
    const animSpeedSlider = document.getElementById('animation-speed');
    
    if (petSizeSlider) {
        petSizeSlider.addEventListener('input', (e) => {
            currentPetSize = parseInt(e.target.value);
            updateSliderDisplay('pet-size', currentPetSize, '%');
        });
    }
    if (petOpacitySlider) {
        petOpacitySlider.addEventListener('input', (e) => {
            currentPetOpacity = parseInt(e.target.value);
            updateSliderDisplay('pet-opacity', currentPetOpacity, '%');
        });
    }
    if (animSpeedSlider) {
        animSpeedSlider.addEventListener('input', (e) => {
            currentAnimationSpeed = parseFloat(e.target.value);
            updateSliderDisplay('animation-speed', currentAnimationSpeed.toFixed(1), 'x');
        });
    }
});