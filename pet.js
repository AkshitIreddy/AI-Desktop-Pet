//checkpoint 1
const { ipcRenderer } = require('electron');
const { ConvaiClient } = require('convai-web-sdk');
const pet = document.getElementById('pet');
const characters = require('./characters.json');

const urlParams = new URLSearchParams(window.location.search);
const characterName = urlParams.get('character');
const characterData = characters[characterName];

let position = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };
let frame = 0;
const walkFrames = Array.from({ length: characterData.walk_max_frame }, (_, i) => `assets/${characterName}/walk${i + 1}.png`);
const climbFrames = Array.from({ length: characterData.climb_max_frames }, (_, i) => `assets/${characterName}/climb${i + 1}.png`);
const fallFrames = Array.from({ length: characterData.fall_max_frames }, (_, i) => `assets/${characterName}/fall${i + 1}.png`);
const dragFrames = Array.from({ length: characterData.drag_max_frames }, (_, i) => `assets/${characterName}/drag${i + 1}.png`);
let lastFrameTime = 0;
let lastMoveTime = 0;
let defaultFrameDuration = 200;
let defaultMoveDuration = 12;
let frameDuration = defaultFrameDuration;
let moveDuration = defaultMoveDuration;
let state = 'falling';
let fallAnimationStarted = false;
let specialActionFrames = [];
let currentSpecialAction = null;
let specialActionLoopCount = 0;
let specialActionLoopEndOnly = false;
let idleActionFrames = [];
let currentIdleAction = null;
let idleActionLoopCount = 0;

const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;
const petWidth = 100;
const petHeight = 100;

const gravity = 0.1;
const damping = 0.98;

// Pre-calculated constant for landing position
const landingY = screenHeight - petHeight;

// Animation frame and interval tracking for cleanup
let animationFrameId = null;
let responseBoxUpdateInterval = null;
let responseBoxCheckInterval = null;

// Track previous state for optimization
let previousTransform = '';
let previousPosition = { x: -1, y: -1 };

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

let currentDragFrame = null;

let remainingWalkDistance = 0;

let midpointCheckDone = false;
let nextState = '';

let textBox = null;

let isHoveringTextbox = false;

let characterId = null;
let apiKey = null;
let sessionId = null;
let convaiClient = null;
let isNPCTalking = false;

let responseBox = null;
let currentResponseText = '';

// Update the character config handler to initialize Convai client
ipcRenderer.on('character-config', (event, config) => {
    characterId = config.characterId;
    apiKey = config.apiKey;
    sessionId = config.sessionId;
    
    // Initialize Convai client
    convaiClient = new ConvaiClient({
        apiKey: apiKey,
        characterId: characterId,
        enableAudio: true,
        sessionId: "-1",  // Hardcoded for now
        micUsage: false
    });

    // Set up response callback
    convaiClient.setResponseCallback((response) => {
        if (response.hasAudioResponse()) {
            const audioResponse = response.getAudioResponse();
            showResponseBox(audioResponse.getTextData());
        }
    });

    // Set up audio state handlers
    convaiClient.onAudioPlay(() => {
        isNPCTalking = true;
    });

    convaiClient.onAudioStop(() => {
        isNPCTalking = false;
    });
});

// Pet customization settings
let petSizeScale = 1.0;
let petOpacityValue = 1.0;
let animationSpeedMultiplier = 1.0;

// Apply pet customization settings
function applyPetSettings(settings) {
    if (settings.petSize !== undefined) {
        petSizeScale = settings.petSize / 100;
        // Force transform update by clearing previous
        previousTransform = '';
    }
    if (settings.petOpacity !== undefined) {
        petOpacityValue = settings.petOpacity / 100;
        pet.style.opacity = petOpacityValue;
    }
    
    // Update base durations from settings if provided
    if (settings.defaultFrameDuration !== undefined) {
        defaultFrameDuration = settings.defaultFrameDuration;
    }
    if (settings.defaultMoveDuration !== undefined) {
        defaultMoveDuration = settings.defaultMoveDuration;
    }
    
    // Apply animation speed multiplier
    if (settings.animationSpeed !== undefined) {
        animationSpeedMultiplier = settings.animationSpeed;
    }
    
    // Recalculate actual durations based on speed multiplier
    // Higher speed = lower duration (faster), lower speed = higher duration (slower)
    frameDuration = Math.round(defaultFrameDuration / animationSpeedMultiplier);
    moveDuration = Math.round(defaultMoveDuration / animationSpeedMultiplier);
}

// Listen for settings updates from main process
ipcRenderer.on('settings-updated', (event, settings) => {
    applyPetSettings(settings);
});

// Update API key handler
ipcRenderer.on('api-key-updated', (event, newKey) => {
    apiKey = newKey;
    if (convaiClient) {
        convaiClient = new ConvaiClient({
            apiKey: newKey,
            characterId: characterId,
            enableAudio: true,
            sessionId: "-1",
            micUsage: false
        });

        // Re-register the response callback
        convaiClient.setResponseCallback((response) => {
            if (response.hasAudioResponse()) {
                const audioResponse = response.getAudioResponse();
                showResponseBox(audioResponse.getTextData());
            }
        });

        // Re-register audio state handlers
        convaiClient.onAudioPlay(() => {
            isNPCTalking = true;
        });

        convaiClient.onAudioStop(() => {
            isNPCTalking = false;
        });
    }
});

// Request the configuration when the page loads
ipcRenderer.send('get-character-config', characterName);

// Add this near the start of the file - get initial settings
ipcRenderer.send('get-settings');
ipcRenderer.on('settings', (event, settings) => {
    applyPetSettings(settings);
});


function calculateWalkDistance() {
    return Math.floor(Math.random() * (screenWidth / 6)) + Math.floor(screenWidth / 6);
}

function shouldContinueClimbing() {
    return Math.random() < 0.5;
}

function startFalling(direction) {
    state = 'falling';
    velocity = { x: 0, y: 0 };
    fallAnimationStarted = false;
    frame = 0;
    midpointCheckDone = false;
    
    if (direction === 'left') {
        remainingWalkDistance = calculateWalkDistance();
    } else if (direction === 'right') {
        remainingWalkDistance = calculateWalkDistance();
    } else {
        // For top bar, randomly select direction
        remainingWalkDistance = calculateWalkDistance();
        direction = Math.random() < 0.5 ? 'left' : 'right';
    }
    
    // Set the next state after falling
    if (direction === 'left') {
        nextState = 'walkingLeftBottom';
    } else {
        nextState = 'walkingRightBottom';
    }
}

pet.addEventListener("mouseenter", () => {
    ipcRenderer.send('set-ignore-mouse-events', false);
});

pet.addEventListener("mouseleave", () => {
    if (!isDragging) {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
});

pet.addEventListener("mousedown", (e) => {
    if (e.altKey) {
        // Create text box if it doesn't exist
        if (!textBox) {
            // Enable window focus when creating textbox
            ipcRenderer.send('set-window-focusable', true);
            
            textBox = document.createElement('div');
            textBox.style.position = 'absolute';
            textBox.style.zIndex = '1000';
            textBox.style.backgroundColor = '#3a3a3a';
            textBox.style.border = '1px solid #555';
            textBox.style.borderRadius = '4px';
            textBox.style.padding = '5px';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.style.width = '200px';
            input.style.background = '#3a3a3a';
            input.style.color = 'white';
            input.style.border = '1px solid #555';
            input.style.borderRadius = '4px';
            
            // Make input interactable
            input.addEventListener('mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', false);
            });
            
            input.addEventListener('mouseleave', () => {
                if (!isDragging) {
                    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                }
            });
            
            // Add submit button
            const submitBtn = document.createElement('img');
            submitBtn.src = 'assets/icons/submit.png';
            submitBtn.style.width = '20px';
            submitBtn.style.height = '20px';
            submitBtn.style.marginLeft = '5px';
            submitBtn.style.cursor = 'pointer';
            submitBtn.style.verticalAlign = 'middle';
            
            // Make submit button interactable
            submitBtn.addEventListener('mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', false);
            });
            
            submitBtn.addEventListener('mouseleave', () => {
                if (!isDragging) {
                    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                }
            });
            
            submitBtn.onclick = async () => {
                const userText = input.value;
                if (!userText.trim()) return;

                // Close textbox
                document.body.removeChild(textBox);
                textBox = null;
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                ipcRenderer.send('set-window-focusable', false);
                isHoveringTextbox = false;

                try {
                    // Send text to Convai
                    convaiClient.sendTextChunk(userText);
                } catch (error) {
                    console.error('API request failed:', error);
                }
            };
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'X';
            closeBtn.style.marginLeft = '5px';
            closeBtn.style.background = '#4a4a4a';
            closeBtn.style.color = 'white';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.transition = 'background-color 0.2s';
            closeBtn.style.border = 'none';
            closeBtn.style.borderRadius = '4px';
            closeBtn.style.padding = '4px 8px';
            
            closeBtn.addEventListener('mouseover', () => {
                closeBtn.style.background = '#5a5a5a';
            });
            
            closeBtn.addEventListener('mouseout', () => {
                closeBtn.style.background = '#4a4a4a';
            });
            
            closeBtn.addEventListener('mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', false);
            });
            
            closeBtn.addEventListener('mouseleave', () => {
                if (!isDragging) {
                    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                }
            });
            
            closeBtn.onclick = () => {
                document.body.removeChild(textBox);
                textBox = null;
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                // Disable window focus when closing textbox
                ipcRenderer.send('set-window-focusable', false);
                isHoveringTextbox = false;
            };
            
            textBox.appendChild(input);
            textBox.appendChild(submitBtn);
            textBox.appendChild(closeBtn);
            document.body.appendChild(textBox);
            
            // Add event listeners after textbox is created and appended
            textBox.addEventListener('mouseenter', () => {
                isHoveringTextbox = true;
            });
            
            textBox.addEventListener('mouseleave', () => {
                isHoveringTextbox = false;
            });
        }
        
        // Position the textbox above the pet
        textBox.style.left = `${position.x}px`;
        textBox.style.bottom = `${screenHeight - position.y}px`;
        
        // Enable mouse events when textbox is created
        ipcRenderer.send('set-ignore-mouse-events', false);
        return;
    }
    
    // Original dragging logic
    isDragging = true;
    dragOffsetX = e.clientX - position.x;
    dragOffsetY = e.clientY - position.y;
    currentDragFrame = dragFrames[Math.floor(Math.random() * dragFrames.length)];
    pet.style.backgroundImage = `url('${currentDragFrame}')`;
    pet.classList.add('dragging');
    ipcRenderer.send('set-ignore-mouse-events', false);
});

document.addEventListener("mousemove", (e) => {
    if (isDragging) {
        position.x = e.clientX - dragOffsetX;
        position.y = e.clientY - dragOffsetY;
        updatePetPosition();
    }
});

document.addEventListener("mouseup", () => {
    if (isDragging) {
        isDragging = false;
        state = 'falling';
        velocity = { x: 0, y: 0 };
        fallAnimationStarted = false;
        frame = 0;
        currentDragFrame = null;
        pet.classList.remove('dragging');
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
});

function updatePetPosition() {
    // Only update DOM if position actually changed
    if (position.x !== previousPosition.x || position.y !== previousPosition.y) {
        pet.style.left = `${position.x}px`;
        pet.style.bottom = `${screenHeight - position.y - petHeight}px`;
        previousPosition.x = position.x;
        previousPosition.y = position.y;
    }
}

// Optimized transform update - combines with pet size scale
function setTransform(transform) {
    // Combine the animation transform with the size scale
    const combinedTransform = petSizeScale !== 1.0 
        ? `${transform} scale(${petSizeScale})`
        : transform;
    
    if (combinedTransform !== previousTransform) {
        pet.style.transform = combinedTransform;
        previousTransform = combinedTransform;
    }
}

function updateAnimation(currentTime) {
    if (currentTime - lastFrameTime > frameDuration) {
        let frames;
        if (isDragging) {
            return; // Don't update animation if dragging
        } else if (state === 'falling') {
            if (!fallAnimationStarted) {
                moveDuration = 8;
                pet.style.backgroundImage = `url('${fallFrames[0]}')`;
            } else {
                return; // Don't update frame if fall animation has started
            }
        } else if (state === 'specialAction') {
            frames = specialActionFrames;
        } else if (state === 'idleAction') {
            frames = idleActionFrames;
        } else if (state.includes('climb')) {
            frames = climbFrames;
        } else {
            frames = walkFrames;
        }
        
        if (frames) {
            if (state === 'specialAction' && specialActionLoopEndOnly) {
                if (frame < frames.length - 1 || specialActionLoopCount === 0) {
                    frame = (frame + 1) % frames.length;
                }
            } else {
                frame = (frame + 1) % frames.length;
            }
            pet.style.backgroundImage = `url('${frames[frame]}')`;

            if (state === 'specialAction' && frame === frames.length - 1) {
                if (currentSpecialAction.loop) {
                    specialActionLoopCount++;
                    if (specialActionLoopCount >= currentSpecialAction.loop_times) {
                        selectAction();
                    } else if (specialActionLoopEndOnly) {
                        // Stay on the last frame
                        frame = frames.length - 1;
                    }
                } else {
                    selectAction();
                }
            } else if (state === 'idleAction' && frame === frames.length - 1) {
                if (currentIdleAction.loop) {
                    idleActionLoopCount++;
                    if (idleActionLoopCount >= currentIdleAction.loop_times) {
                        selectAction();
                    }
                } else {
                    selectAction();
                }
            }
        }
        lastFrameTime = currentTime;
    }
}

function selectRandomWalk() {
    const walkDirection = Math.random() < 0.5 ? 'walkingRightBottom' : 'walkingLeftBottom';
    remainingWalkDistance = Math.floor(Math.random() * (screenWidth / 6)) + Math.floor(screenWidth / 6);
    state = walkDirection;
    frame = 0; // Reset frame for walk animation
}

function selectAction() {
    const randomValue = Math.random();
    
    if (randomValue < 0.2) {
        selectIdleAction();
    } else if (randomValue < 0.5) {
        selectSpecialAction();
    } else {
        selectRandomWalk();
    }
}

function selectIdleAction() {
    const idleActions = characterData.idle_actions;
    const actionKeys = Object.keys(idleActions);
    if (actionKeys.length === 0) {
        selectRandomWalk(); // Fallback to walk if no idle actions
        return;
    }

    const randomAction = actionKeys[Math.floor(Math.random() * actionKeys.length)];
    currentIdleAction = idleActions[randomAction];

    const actionNumber = randomAction.split('_')[2];

    idleActionFrames = Array.from(
        { length: currentIdleAction.max_frames },
        (_, i) => `assets/${characterName}/id${actionNumber}_${i + 1}.png`
    );

    frame = 0;
    idleActionLoopCount = 0;
    state = 'idleAction';
}

function selectSpecialAction() {
    const specialActions = characterData.special_actions;
    const actionKeys = Object.keys(specialActions);
    if (actionKeys.length === 0) {
        selectRandomWalk(); // Fallback to walk if no special actions
        return;
    }

    const randomAction = actionKeys[Math.floor(Math.random() * actionKeys.length)];
    currentSpecialAction = specialActions[randomAction];

    const actionNumber = randomAction.split('_')[2]; 

    specialActionFrames = Array.from(
        { length: currentSpecialAction.max_frames },
        (_, i) => `assets/${characterName}/sp${actionNumber}_${i + 1}.png`
    );

    frame = 0;
    specialActionLoopCount = 0;
    state = 'specialAction';
    specialActionLoopEndOnly = currentSpecialAction.loop_end_only || false;
}

function walkingLeftBottom() {
    if (remainingWalkDistance > 0) {
        position.x -= 1;
        remainingWalkDistance--;
        setTransform('scaleX(1) rotate(0deg)');
    } else {
        selectAction();
    }
    if (position.x <= 0) {
        state = 'climbingLeftSidebarDownToUp';
    }
}

function walkingRightBottom() {
    if (remainingWalkDistance > 0) {
        position.x += 1;
        remainingWalkDistance--;
        setTransform('scaleX(-1) rotate(0deg)');
    } else {
        selectAction();
    }
    if (position.x >= screenWidth - petWidth) {
        state = 'climbingRightSidebarDownToUp';
    }
}

function climbingLeftSidebarUpToDown() {
    position.y += 1;
    setTransform('scaleX(1) rotate(0deg)');
    
    if (!midpointCheckDone && position.y >= screenHeight / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('right');
            return;
        }
    }
    
    if (position.y >= screenHeight - petHeight) {
        state = 'walkingRightBottom';
        midpointCheckDone = false;
    }
}

function climbingLeftSidebarDownToUp() {
    position.y -= 1;
    setTransform('scaleX(1) rotate(0deg)');
    
    if (!midpointCheckDone && position.y <= screenHeight / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('right');
            return;
        }
    }
    
    if (position.y <= 0) {
        state = 'climbingTopRight';
        midpointCheckDone = false;
    }
}

function climbingRightSidebarUpToDown() {
    position.y += 1;
    setTransform('scaleX(-1) rotate(0deg)');
    
    if (!midpointCheckDone && position.y >= screenHeight / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('left');
            return;
        }
    }
    
    if (position.y >= screenHeight - petHeight) {
        state = 'walkingLeftBottom';
        midpointCheckDone = false;
    }
}

function climbingRightSidebarDownToUp() {
    position.y -= 1;
    setTransform('scaleX(-1) rotate(0deg)');
    
    if (!midpointCheckDone && position.y <= screenHeight / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('left');
            return;
        }
    }
    
    if (position.y <= 0) {
        state = 'climbingTopLeft';
        midpointCheckDone = false;
    }
}

function climbingTopLeft() {
    position.x -= 1;
    setTransform('scaleX(-1) rotate(90deg)');
    
    if (!midpointCheckDone && position.x <= screenWidth / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('top');
            return;
        }
    }
    
    if (position.x <= 0) {
        state = 'climbingLeftSidebarUpToDown';
        midpointCheckDone = false;
    }
}

function climbingTopRight() {
    position.x += 1;
    setTransform('scaleX(1) rotate(90deg)');
    
    if (!midpointCheckDone && position.x >= screenWidth / 2) {
        midpointCheckDone = true;
        if (!shouldContinueClimbing()) {
            startFalling('top');
            return;
        }
    }
    
    if (position.x >= screenWidth - petWidth) {
        state = 'climbingRightSidebarUpToDown';
        midpointCheckDone = false;
    }
}

function falling() {
    setTransform('scaleX(1) rotate(0deg)');
    velocity.y += gravity;
    velocity.y *= damping;
    
    position.y += velocity.y;

    // Check if we've reached the bottom (using pre-calculated landingY)
    if (position.y >= landingY + 3) {
        if (!fallAnimationStarted) {
            frame = 1;
            fallAnimationStarted = true;
            position.y = landingY + 3;
        }
        if (frame < fallFrames.length + 1) {
            pet.style.backgroundImage = `url('${fallFrames[frame]}')`;
            
            if (frame >= 1 && frame <= 3) {
                position.y -= velocity.y;
                moveDuration = 140;
            } else if (frame == 4) {
                position.y -= velocity.y;
                moveDuration = 600;
            } else {
                frameDuration = defaultFrameDuration;
                moveDuration = defaultMoveDuration;
            }
            
            frame++;
        }
    }

    if (frame >= fallFrames.length + 1) {
        position.y = landingY;
        
        // Landed on screen bottom
        if (nextState !== '') {
            state = nextState;
            nextState = '';
        } else {
            selectAction();
        }
        
        fallAnimationStarted = false;
        frameDuration = defaultFrameDuration;
        moveDuration = defaultMoveDuration;
    }
}

function updatePosition() {
    switch (state) {
        case 'falling':
            falling();
            break;
        case 'walkingLeftBottom':
            walkingLeftBottom();
            break;
        case 'walkingRightBottom':
            walkingRightBottom();
            break;
        case 'climbingLeftSidebarUpToDown':
            climbingLeftSidebarUpToDown();
            break;
        case 'climbingLeftSidebarDownToUp':
            climbingLeftSidebarDownToUp();
            break;
        case 'climbingRightSidebarUpToDown':
            climbingRightSidebarUpToDown();
            break;
        case 'climbingRightSidebarDownToUp':
            climbingRightSidebarDownToUp();
            break;
        case 'climbingTopLeft':
            climbingTopLeft();
            break;
        case 'climbingTopRight':
            climbingTopRight();
            break;
        case 'specialAction':
        case 'idleAction':
            // Don't update position for special actions or idle actions
            break;
    }

    let adjustedX = position.x;
    let adjustedY = position.y;

    // Adjust for right edge
    if (state.includes('Right')) {
        adjustedX += 35;
    }
    // Adjust for left edge
    else if (state.includes('Left')) {
        adjustedX -= 35;
    }

    // Adjust for top edge
    if (state.includes('Top')) {
        adjustedY -= 35;
    }

    pet.style.left = `${adjustedX}px`;
    pet.style.bottom = `${screenHeight - adjustedY - petHeight}px`;
}

function updateTextBoxPosition() {
    if (!textBox) return;

    const offset = 20;

    const textBoxWidth = textBox.offsetWidth;
    const textBoxHeight = textBox.offsetHeight;

    if (state.includes('climbingTop')) { 
        textBox.style.left = `${position.x}px`;
        textBox.style.top = `${position.y + 3*offset}px`;
        textBox.style.bottom = 'auto';
    } else if (state.includes('climbingLeft')) { 
        textBox.style.left = `${position.x + offset}px`;
        textBox.style.top = `${position.y - 1.3*textBoxHeight}px`;
        textBox.style.bottom = 'auto';
    } else if (state.includes('climbingRight')) { 
        textBox.style.left = `${position.x - textBoxWidth + 2*offset}px`;
        textBox.style.top = `${position.y - (textBoxHeight/2)}px`;
        textBox.style.bottom = 'auto';
    } else {
        textBox.style.left = `${position.x - (textBoxWidth/4)}px`;
        textBox.style.bottom = `${screenHeight - position.y + offset/5}px`;
        textBox.style.top = 'auto';
    }
}

function updatePet(currentTime) {
    if (!isDragging && !isHoveringTextbox) {
        updateAnimation(currentTime);

        if (currentTime - lastMoveTime > moveDuration) {
            updatePosition();
            lastMoveTime = currentTime;
        }
    }

    updateTextBoxPosition();

    animationFrameId = requestAnimationFrame(updatePet);
}

// Initialize pet position at a random position at the top
position = { x: Math.random() * (screenWidth - petWidth), y: 0 };
updatePetPosition();

animationFrameId = requestAnimationFrame(updatePet);

// Cleanup function for window unload
function cleanup() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (responseBoxUpdateInterval) {
        clearInterval(responseBoxUpdateInterval);
        responseBoxUpdateInterval = null;
    }
    if (responseBoxCheckInterval) {
        clearInterval(responseBoxCheckInterval);
        responseBoxCheckInterval = null;
    }
}

// Cleanup on window close
window.addEventListener('beforeunload', cleanup);

function showResponseBox(text) {
    // Append new text to current response
    currentResponseText += text;
    
    // If there's no response box, create one
    if (!responseBox) {
        responseBox = document.createElement('div');
        responseBox.style.position = 'absolute';
        responseBox.style.zIndex = '1000';
        responseBox.style.backgroundColor = '#3a3a3a';
        responseBox.style.border = '1px solid #555';
        responseBox.style.borderRadius = '4px';
        responseBox.style.padding = '10px';
        responseBox.style.maxWidth = '300px';
        responseBox.style.color = 'white';
        responseBox.style.wordWrap = 'break-word';
        
        document.body.appendChild(responseBox);
    }
    
    // Update text content
    responseBox.textContent = currentResponseText;
    
    // Update position function - cache offsetWidth/Height
    function updateResponseBoxPosition() {
        if (!responseBox) return;
        const offset = 20;
        const boxWidth = responseBox.offsetWidth;
        const boxHeight = responseBox.offsetHeight;
        
        if (state.includes('climbingTop')) { 
            responseBox.style.left = `${position.x}px`;
            responseBox.style.top = `${position.y + 3*offset}px`;
            responseBox.style.bottom = 'auto';
        } else if (state.includes('climbingLeft')) { 
            responseBox.style.left = `${position.x + offset}px`;
            responseBox.style.top = `${position.y - 1.3*boxHeight}px`;
            responseBox.style.bottom = 'auto';
        } else if (state.includes('climbingRight')) { 
            responseBox.style.left = `${position.x - boxWidth + 2*offset}px`;
            responseBox.style.top = `${position.y - (boxHeight/2)}px`;
            responseBox.style.bottom = 'auto';
        } else {
            responseBox.style.left = `${position.x - (boxWidth/4)}px`;
            responseBox.style.bottom = `${screenHeight - position.y + offset/5}px`;
            responseBox.style.top = 'auto';
        }
    }

    // Initial position
    updateResponseBoxPosition();

    // Clear any existing intervals before creating new ones
    if (responseBoxUpdateInterval) {
        clearInterval(responseBoxUpdateInterval);
    }
    if (responseBoxCheckInterval) {
        clearInterval(responseBoxCheckInterval);
    }

    // Start position update interval (use 50ms instead of 16ms - sufficient for text)
    responseBoxUpdateInterval = setInterval(updateResponseBoxPosition, 50);

    // Check audio state to clean up when done
    responseBoxCheckInterval = setInterval(() => {
        if (!isNPCTalking) {
            clearInterval(responseBoxUpdateInterval);
            clearInterval(responseBoxCheckInterval);
            responseBoxUpdateInterval = null;
            responseBoxCheckInterval = null;
            if (responseBox && responseBox.parentNode) {
                responseBox.parentNode.removeChild(responseBox);
                responseBox = null;
                currentResponseText = '';
            }
        }
    }, 100);
}