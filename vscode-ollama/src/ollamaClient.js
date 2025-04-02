/**
 * Client-side JavaScript for the VS Code Ollama extension
 */

// Initialize VS Code API and DOM elements
const vscode = acquireVsCodeApi();
const chatContainer = document.getElementById('chat-container');
const promptInput = document.getElementById('prompt-input');
const sendButton = document.getElementById('send-button');
const modelDisplay = document.getElementById('model-display');

// State variables
let currentResponseElement = null;
let pendingScrolls = [];
let currentResponseText = '';

// Session management variables
let availableModels = [];
const currentSessionDisplay = document.getElementById('current-session-name');
const sessionSelector = document.getElementById('session-selector');
const sessionDropdown = document.getElementById('session-dropdown');
const sessionsList = document.getElementById('sessions-list');
const newSessionButton = document.getElementById('new-session-button');
const modelSelector = document.getElementById('model-selector');
const modelDropdown = document.getElementById('model-dropdown');
const modelsList = document.getElementById('models-list');

// Smooth scroll function
function smoothScrollToBottom() {
    if (pendingScrolls.length > 0) {
        // Only keep the last scroll request
        pendingScrolls = [pendingScrolls[pendingScrolls.length - 1]];
        return;
    }
    
    const start = chatContainer.scrollTop;
    const end = chatContainer.scrollHeight - chatContainer.clientHeight;
    const duration = 300; // ms
    const startTime = performance.now();
    
    const scrollId = Date.now();
    pendingScrolls.push(scrollId);
    
    // Only smooth scroll if there's a significant difference
    if (end - start > 100) {
        requestAnimationFrame(function step(timestamp) {
            // If this scroll request has been superseded, cancel it
            if (!pendingScrolls.includes(scrollId)) return;
            
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out function
            const easeOut = 1 - Math.pow(1 - progress, 3);
            chatContainer.scrollTop = start + (end - start) * easeOut;
            
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                // Ensure we're all the way at the bottom
                chatContainer.scrollTop = end;
                // Remove this scroll from pending
                pendingScrolls = pendingScrolls.filter(id => id !== scrollId);
            }
        });
    } else {
        // For small scrolls, just jump
        chatContainer.scrollTop = end;
        pendingScrolls = pendingScrolls.filter(id => id !== scrollId);
    }
}

// Auto-resize textarea
function autoResizeTextarea() {
    promptInput.style.height = 'auto';
    const newHeight = Math.min(promptInput.scrollHeight, 150); // Maximum height of 150px
    promptInput.style.height = newHeight + 'px';
}

// Add action buttons to code blocks
function addCodeBlockActionButtons(element) {
    // Find all code blocks
    const codeBlocks = element.querySelectorAll('pre code');
    if (!codeBlocks.length) return;
    
    // Process each code block
    codeBlocks.forEach((codeBlock, index) => {
        const preElement = codeBlock.parentElement;
        if (!preElement) return;
        
        // Skip if we already added buttons to this block
        if (preElement.querySelector('.code-actions')) return;
        
        // Create action buttons container
        const actionContainer = document.createElement('div');
        actionContainer.className = 'code-actions';
        actionContainer.style.display = 'flex';
        actionContainer.style.justifyContent = 'flex-end';
        actionContainer.style.padding = '4px';
        actionContainer.style.backgroundColor = 'var(--vscode-editor-background)';
        actionContainer.style.borderTop = '1px solid var(--vscode-editor-lineHighlightBorder)';
        
        // Add Copy button
        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy';
        copyButton.className = 'code-action-button';
        copyButton.style.marginRight = '8px';
        copyButton.style.fontSize = '12px';
        copyButton.style.padding = '2px 8px';
        copyButton.addEventListener('click', () => {
            // Get the code text
            const code = codeBlock.textContent || '';
            
            // Copy to clipboard using VS Code's clipboard
            vscode.postMessage({
                command: 'copyToClipboard',
                text: code
            });
            
            // Show feedback
            const originalText = copyButton.textContent;
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
                copyButton.textContent = originalText;
            }, 2000);
        });
        
        // Add Apply button (for code changes)
        const applyButton = document.createElement('button');
        applyButton.textContent = 'Apply to Editor';
        applyButton.className = 'code-action-button';
        applyButton.style.fontSize = '12px';
        applyButton.style.padding = '2px 8px';
        applyButton.addEventListener('click', () => {
            // Get the code text
            const code = codeBlock.textContent || '';
            
            // Send to VS Code to apply to the current file
            vscode.postMessage({
                command: 'applyCodeToEditor',
                text: code,
                blockIndex: index
            });
            
            // Show feedback
            const originalText = applyButton.textContent;
            applyButton.textContent = 'Applied!';
            setTimeout(() => {
                applyButton.textContent = originalText;
            }, 2000);
        });
        
        // Add buttons to container
        actionContainer.appendChild(copyButton);
        actionContainer.appendChild(applyButton);
        
        // Append to pre element
        preElement.appendChild(actionContainer);
    });
}

// Check if user is scrolled near bottom
function isUserNearBottom() {
    const scrollPosition = chatContainer.scrollTop + chatContainer.clientHeight;
    const scrollHeight = chatContainer.scrollHeight;
    const threshold = 150; // pixels from bottom
    return scrollHeight - scrollPosition <= threshold;
}

// Send prompt to extension
function sendPrompt() {
    const text = promptInput.value.trim();
    if (text) {
        addUserMessage(text);
        promptInput.value = '';
        autoResizeTextarea();
        
        // Fetch latest context when sending prompt to ensure we have current selection
        vscode.postMessage({ command: 'refreshContext' });
        
        // Short delay to allow context refresh to complete before sending prompt
        setTimeout(() => {
            vscode.postMessage({
                command: 'sendPrompt',
                text: text,
                includeContext: true // Always include context
            });
        }, 100);
    }
}

// Add user message to chat
function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user-message';
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Add bot message
function addBotMessage(text = '') {
    const div = document.createElement('div');
    div.className = 'message bot-message';
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return div;
}

// Format date for session display
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) {
        return 'just now';
    } else if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return date.toLocaleDateString();
    }
}

// Toggle dropdown
function toggleDropdown(dropdown) {
    if (dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
    } else {
        // Close all other dropdowns
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('active'));
        dropdown.classList.add('active');
    }
}

// Close all dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('active'));
    }
});

// Update sessions list in the dropdown
function updateSessionsList(sessions, currentSessionId) {
    if (!sessionsList) return;
    
    // Clear current list
    sessionsList.innerHTML = '';
    
    // Sort sessions by last updated time
    const sortedSessions = [...sessions].sort((a, b) => b.lastUpdated - a.lastUpdated);
    
    // Add each session to the list
    sortedSessions.forEach(session => {
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');
        sessionItem.setAttribute('data-session-id', session.id);
        
        // Create session info
        const sessionInfo = document.createElement('div');
        sessionInfo.className = 'session-info';
        
        const sessionName = document.createElement('div');
        sessionName.className = 'session-name';
        sessionName.textContent = session.name;
        
        const sessionDetails = document.createElement('div');
        sessionDetails.className = 'session-details';
        sessionDetails.style.fontSize = '11px';
        sessionDetails.style.opacity = '0.8';
        sessionDetails.textContent = `${session.modelName || 'No model'} · ${formatDate(session.lastUpdated)}`;
        
        sessionInfo.appendChild(sessionName);
        sessionInfo.appendChild(sessionDetails);
        
        // Create session actions
        const sessionActions = document.createElement('div');
        sessionActions.className = 'session-actions';
        
        const renameAction = document.createElement('span');
        renameAction.className = 'session-action rename-session';
        renameAction.textContent = 'Rename';
        renameAction.addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('Enter new session name:', session.name);
            if (newName && newName.trim()) {
                vscode.postMessage({
                    command: 'renameSession',
                    sessionId: session.id,
                    name: newName.trim()
                });
            }
        });
        
        const deleteAction = document.createElement('span');
        deleteAction.className = 'session-action delete-session';
        deleteAction.textContent = 'Delete';
        deleteAction.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete "${session.name}"?`)) {
                vscode.postMessage({
                    command: 'deleteSession',
                    sessionId: session.id
                });
            }
        });
        
        sessionActions.appendChild(renameAction);
        sessionActions.appendChild(deleteAction);
        
        // Add elements to the session item
        sessionItem.appendChild(sessionInfo);
        sessionItem.appendChild(sessionActions);
        
        // Add click handler for selecting a session
        sessionItem.addEventListener('click', () => {
            vscode.postMessage({
                command: 'switchSession',
                sessionId: session.id
            });
            document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('active'));
        });
        
        // Add to the list
        sessionsList.appendChild(sessionItem);
    });
    
    // Update current session name in the header
    if (currentSessionId) {
        const currentSession = sessions.find(s => s.id === currentSessionId);
        if (currentSession) {
            currentSessionDisplay.textContent = currentSession.name;
            
            // Also update model display if it exists
            if (currentSession.modelName) {
                modelDisplay.textContent = 'Model: ' + currentSession.modelName;
            }
        }
    }
}

// Load session messages into the chat
function loadSessionMessages(messages) {
    // Clear chat container
    chatContainer.innerHTML = '';
    
    // Add each message to the chat
    messages.forEach(msg => {
        if (msg.role === 'user') {
            addUserMessage(msg.content);
        } else {
            // Add bot message with markdown parsing
            const msgElement = addBotMessage();
            try {
                msgElement.innerHTML = parseMarkdown(msg.content);
                msgElement.classList.add('markdown-content');
                
                // Add syntax highlighting
                const codeBlocks = msgElement.querySelectorAll('pre code');
                if (codeBlocks.length > 0) {
                    highlightCodeBlocks(codeBlocks);
                }
            } catch (e) {
                console.error('Error formatting message:', e);
                msgElement.textContent = msg.content;
            }
        }
    });
    
    // Scroll to bottom after loading messages
    setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
}

// Update models list in the dropdown
function updateModelsList(models, currentModel) {
    if (!modelsList) return;
    
    // Store available models
    availableModels = models;
    
    // Clear current list
    modelsList.innerHTML = '';
    
    // Add each model to the list
    models.forEach(model => {
        const modelItem = document.createElement('div');
        modelItem.className = 'model-item' + (model.name === currentModel ? ' active' : '');
        modelItem.setAttribute('data-model-name', model.name);
        
        // Create model name display
        const modelName = document.createElement('div');
        modelName.className = 'model-name';
        modelName.textContent = model.name;
        
        // Create model details if available
        if (model.details) {
            const modelDetails = document.createElement('div');
            modelDetails.className = 'model-details';
            modelDetails.style.fontSize = '11px';
            modelDetails.style.opacity = '0.8';
            modelDetails.textContent = model.details;
            modelItem.appendChild(modelDetails);
        }
        
        // Add elements to the model item
        modelItem.appendChild(modelName);
        
        // Add click handler for selecting a model
        modelItem.addEventListener('click', () => {
            vscode.postMessage({
                command: 'setModel',
                model: model.name
            });
            document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('active'));
        });
        
        // Add to the list
        modelsList.appendChild(modelItem);
    });
}

// Initialize event listeners for session management
if (sessionSelector) {
    sessionSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = sessionSelector.closest('.dropdown');
        toggleDropdown(dropdown);
    });
}

if (modelSelector) {
    modelSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = modelSelector.closest('.dropdown');
        toggleDropdown(dropdown);
        
        // If no models are loaded yet, fetch them
        if (availableModels.length === 0) {
            vscode.postMessage({
                command: 'getModels'
            });
        }
    });
}

if (newSessionButton) {
    newSessionButton.addEventListener('click', () => {
        vscode.postMessage({
            command: 'createNewSession'
        });
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('active'));
    });
}

// Auto-resize textarea on input
promptInput.addEventListener('input', autoResizeTextarea);

// Event listeners
sendButton.addEventListener('click', sendPrompt);

promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
    }
});

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'setModel':
            modelDisplay.textContent = 'Model: ' + message.model;
            break;
            
        case 'updateSessions':
            updateSessionsList(message.sessions, message.currentSessionId);
            break;
            
        case 'loadSessionMessages':
            loadSessionMessages(message.messages);
            break;
            
        case 'updateModels':
            updateModelsList(message.models, message.currentModel);
            break;
        
        case 'startResponse':
            // Reset current response text
            currentResponseText = '';
            
            // Create a container for the response including cancel button
            const responseContainer = document.createElement('div');
            responseContainer.style.display = 'flex';
            responseContainer.style.flexDirection = 'column';
            responseContainer.style.marginBottom = '20px';
            
            // Create the message element
            currentResponseElement = document.createElement('div');
            currentResponseElement.className = 'message bot-message';
            
            // Create a thinking indicator 
            const thinkingIndicator = document.createElement('div');
            thinkingIndicator.className = 'thinking';
            thinkingIndicator.innerHTML = '<span>Thinking</span> <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
            currentResponseElement.appendChild(thinkingIndicator);
            
            // Create cancel button
            const cancelButton = document.createElement('button');
            cancelButton.className = 'cancel-button';
            cancelButton.textContent = 'Cancel Generation';
            cancelButton.style.display = 'block'; // Show by default
            cancelButton.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'cancelGeneration'
                });
                cancelButton.textContent = 'Cancelling...';
                cancelButton.disabled = true;
            });
            
            // Add elements to container and container to chat
            responseContainer.appendChild(currentResponseElement);
            responseContainer.appendChild(cancelButton);
            chatContainer.appendChild(responseContainer);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            // Show what prompt is being processed, including any context info
            console.log('Processing prompt:', message.prompt);
            if (message.hasContext) {
                console.log('Context included in prompt: active file and selection are available');
            }
            break;
        
        case 'appendResponse':
            if (currentResponseElement) {
                // Remove the thinking indicator if this is not a status message
                const thinkingIndicator = currentResponseElement.querySelector('.thinking');
                if (thinkingIndicator && message.text && !message.text.startsWith('_Thinking')) {
                    thinkingIndicator.remove();
                }
                
                // Format status messages differently
                if (message.text.startsWith('_') && message.text.endsWith('_')) {
                    // Create a status element
                    const statusSpan = document.createElement('div');
                    statusSpan.style.fontStyle = 'italic';
                    statusSpan.style.color = 'var(--vscode-descriptionForeground)';
                    statusSpan.style.marginBottom = '8px';
                    statusSpan.textContent = message.text.substring(1, message.text.length - 1);
                    
                    // Log for debugging
                    console.log('Displaying status message:', statusSpan.textContent);
                    
                    // If there's a previous status message, replace it
                    const previousStatus = currentResponseElement.querySelector('[data-status-message]');
                    if (previousStatus) {
                        previousStatus.textContent = statusSpan.textContent;
                    } else {
                        statusSpan.setAttribute('data-status-message', 'true');
                        currentResponseElement.appendChild(statusSpan);
                    }
                    
                    // If this is an error message, hide the cancel button and show an error style
                    if (statusSpan.textContent.includes('Error:')) {
                        console.log('Error status detected, updating UI');
                        
                        // Add error styling
                        statusSpan.style.color = 'var(--vscode-errorForeground)';
                        statusSpan.style.fontWeight = 'bold';
                        
                        // Hide cancel button since the operation has already failed
                        const container = currentResponseElement.parentElement;
                        if (container) {
                            const cancelButton = container.querySelector('.cancel-button');
                            if (cancelButton) {
                                cancelButton.style.display = 'none';
                            }
                        }
                    }
                } else {
                    // For normal text, append it to our current response
                    console.log('Appending response text:', message.text.substring(0, Math.min(50, message.text.length)) + (message.text.length > 50 ? '...' : ''));
                    
                    // Check for empty container with thinking indicator
                    const thinkingIndicator = currentResponseElement.querySelector('.thinking');
                    if (thinkingIndicator && (!currentResponseText || currentResponseText.trim() === '')) {
                        // If only thinking indicator exists, remove it and start fresh
                        currentResponseElement.innerHTML = '';
                    }
                    
                    // Add network activity indicator to tell the user data is still coming
                    const container = currentResponseElement.parentElement;
                    if (container) {
                        const cancelButton = container.querySelector('.cancel-button');
                        if (cancelButton && cancelButton.style.display !== 'none') {
                            // Update cancel button to show activity
                            cancelButton.textContent = 'Cancel Generation (Receiving Data...)';
                        }
                    }
                    
                    // Reset inactivity timer for client-side response handling
                    if (window.responseTimeoutId) {
                        clearTimeout(window.responseTimeoutId);
                    }
                    
                    // Set a client-side timeout to detect if we stop receiving chunks
                    window.responseTimeoutId = setTimeout(() => {
                        console.log('Client-side response timeout - no chunks received recently');
                        
                        // Show this in the UI to let user know something might be wrong
                        const container = currentResponseElement.parentElement;
                        if (container) {
                            const cancelButton = container.querySelector('.cancel-button');
                            if (cancelButton && cancelButton.style.display !== 'none') {
                                cancelButton.textContent = 'Cancel Generation (Waiting for Response...)';
                                cancelButton.style.backgroundColor = 'var(--vscode-errorForeground)';
                                cancelButton.style.color = 'white';
                                
                                // Add a timeout to auto-cancel if no response for 15 more seconds
                                setTimeout(() => {
                                    if (cancelButton && cancelButton.style.display !== 'none') {
                                        console.log('Auto-cancelling due to prolonged inactivity');
                                        // Trigger cancel action
                                        vscode.postMessage({
                                            command: 'cancelGeneration'
                                        });
                                        // Update button to show it's cancelling
                                        cancelButton.textContent = 'Cancelling...';
                                        cancelButton.disabled = true;
                                    }
                                }, 15000);
                            }
                        }
                    }, 5000); // 5 second timeout if no chunks received
                    
                    // Append to our total response text
                    currentResponseText += message.text;
                    
                    try {
                        // Use the external markdown parser to format the text
                        currentResponseElement.innerHTML = parseMarkdown(currentResponseText);
                        currentResponseElement.classList.add('markdown-content');
                        
                        // Add action buttons to code blocks
                        addCodeBlockActionButtons(currentResponseElement);
                    } catch (e) {
                        console.error('Error parsing markdown:', e);
                        // Fallback to plain text if parsing fails
                        currentResponseElement.textContent = currentResponseText;
                    }
                    
                    // Force redraw by triggering a layout
                    const originalDisplay = currentResponseElement.style.display;
                    currentResponseElement.style.display = 'none';
                    setTimeout(() => {
                        currentResponseElement.style.display = originalDisplay;
                        // Check if user was near bottom, and if so, scroll
                        if (isUserNearBottom()) {
                            smoothScrollToBottom();
                        }
                    }, 0);
                }
            }
            break;
        
        case 'endResponse':
            // Clear any client-side response timeouts
            if (window.responseTimeoutId) {
                clearTimeout(window.responseTimeoutId);
                window.responseTimeoutId = null;
            }
            
            if (currentResponseElement) {
                // Clean up thinking indicator if it still exists
                const thinkingIndicator = currentResponseElement.querySelector('.thinking');
                if (thinkingIndicator) {
                    thinkingIndicator.remove();
                }
                
                // Hide the cancel button when response is complete
                const container = currentResponseElement.parentElement;
                if (container) {
                    const cancelButton = container.querySelector('.cancel-button');
                    if (cancelButton) {
                        cancelButton.style.display = 'none';
                    }
                }
                
                // Check for empty response and add a message if needed
                if (!currentResponseText || currentResponseText.trim() === '') {
                    console.warn('Received an empty response');
                    currentResponseText = '_No response was generated. This could indicate an issue with the model or server._';
                    
                    // Add a status message for empty response
                    const emptyResponseMsg = document.createElement('div');
                    emptyResponseMsg.style.fontStyle = 'italic';
                    emptyResponseMsg.style.color = 'var(--vscode-errorForeground)';
                    emptyResponseMsg.textContent = 'No response was generated. Try again or select a different model.';
                    currentResponseElement.appendChild(emptyResponseMsg);
                }
                
                // Final markdown parsing of the whole response
                if (currentResponseText) {
                    try {
                        // Don't parse if it's just a status/error message (starts and ends with _)
                        if (!(currentResponseText.startsWith('_') && currentResponseText.endsWith('_'))) {
                            currentResponseElement.innerHTML = parseMarkdown(currentResponseText);
                            currentResponseElement.classList.add('markdown-content');
                            
                            // Add syntax highlighting to code blocks
                            const codeBlocks = currentResponseElement.querySelectorAll('pre code');
                            if (codeBlocks.length > 0) {
                                try {
                                    highlightCodeBlocks(codeBlocks);
                                    
                                    // Add action buttons to code blocks
                                    addCodeBlockActionButtons(currentResponseElement);
                                } catch (e) {
                                    console.error('Error applying syntax highlighting:', e);
                                    // Continue without highlighting if there's an error
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error in final markdown parsing:', e);
                        // Fallback to plain text if parsing fails
                        currentResponseElement.textContent = currentResponseText;
                    }
                }
                
                // Add a retry button if the response seems too short or contains an error
                if ((currentResponseText.length < 20 || currentResponseText.includes('Error:')) && 
                    container && !container.querySelector('.retry-button')) {
                    const retryButton = document.createElement('button');
                    retryButton.className = 'retry-button';
                    retryButton.textContent = 'Try Again';
                    retryButton.style.marginTop = '10px';
                    retryButton.addEventListener('click', () => {
                        // Resubmit the last prompt
                        vscode.postMessage({
                            command: 'sendPrompt',
                            text: promptInput.value || 'Please try to answer again',
                            includeContext: true
                        });
                    });
                    container.appendChild(retryButton);
                }
            }
            
            // Reset state
            currentResponseElement = null;
            currentResponseText = '';
            
            // Ensure we scroll to see the full response
            smoothScrollToBottom();
            break;
        
        case 'error':
            // Clear any pending timeouts
            if (window.responseTimeoutId) {
                clearTimeout(window.responseTimeoutId);
                window.responseTimeoutId = null;
            }
            
            if (currentResponseElement) {
                // Remove the thinking indicator if it exists
                const thinkingIndicator = currentResponseElement.querySelector('.thinking');
                if (thinkingIndicator) {
                    thinkingIndicator.remove();
                }
                
                // Create error element with better styling
                const errorElement = document.createElement('div');
                errorElement.className = 'error-message';
                errorElement.style.color = 'var(--vscode-errorForeground)';
                errorElement.style.padding = '8px 12px';
                errorElement.style.marginTop = '8px';
                errorElement.style.marginBottom = '8px';
                errorElement.style.borderLeft = '3px solid var(--vscode-errorForeground)';
                errorElement.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
                
                errorElement.innerHTML = '<strong>Error:</strong> ' + message.message;
                currentResponseElement.appendChild(errorElement);
                
                // Add a retry button
                const container = currentResponseElement.parentElement;
                if (container && !container.querySelector('.retry-button')) {
                    const retryButton = document.createElement('button');
                    retryButton.className = 'retry-button';
                    retryButton.textContent = 'Try Again';
                    retryButton.style.marginTop = '10px';
                    retryButton.addEventListener('click', () => {
                        // Resubmit the last prompt
                        vscode.postMessage({
                            command: 'sendPrompt',
                            text: promptInput.value || 'Please try again',
                            includeContext: true
                        });
                    });
                    
                    // Hide the cancel button
                    const cancelButton = container.querySelector('.cancel-button');
                    if (cancelButton) {
                        cancelButton.style.display = 'none';
                    }
                    
                    container.appendChild(retryButton);
                }
                
                // Reset state after error
                currentResponseElement = null;
                currentResponseText = '';
            } else {
                // If no current response element, create a new message
                const errorMsg = addBotMessage('');
                errorMsg.innerHTML = '<div style="color: var(--vscode-errorForeground);"><strong>Error:</strong> ' + message.message + '</div>';
                
                // Add a retry button directly below the error message
                const retryButton = document.createElement('button');
                retryButton.className = 'retry-button';
                retryButton.textContent = 'Try Again';
                retryButton.style.marginTop = '10px';
                retryButton.addEventListener('click', () => {
                    // Resubmit with default prompt if we don't have one
                    vscode.postMessage({
                        command: 'sendPrompt',
                        text: promptInput.value || 'Please try again',
                        includeContext: true
                    });
                });
                
                errorMsg.appendChild(retryButton);
            }
            
            // Scroll to show the error
            smoothScrollToBottom();
            break;
        
        case 'injectPrompt':
            promptInput.value = message.text;
            autoResizeTextarea();
            // If includeContext flag is provided, use it when sending the prompt
            const includeContext = message.includeContext !== undefined ? message.includeContext : true;
            setTimeout(() => {
                // Instead of using sendPrompt(), send directly with context flag
                const text = promptInput.value.trim();
                if (text) {
                    addUserMessage(text);
                    promptInput.value = '';
                    autoResizeTextarea();
                    
                    // Ensure we get fresh context with current selection
                    vscode.postMessage({ command: 'refreshContext' });
                    
                    vscode.postMessage({
                        command: 'sendPrompt',
                        text: text,
                        includeContext: includeContext
                    });
                }
            }, 100);
            break;
            
        case 'addReference':
            // Create a special reference message
            const referenceElement = document.createElement('div');
            referenceElement.className = 'message bot-message reference-message';
            referenceElement.style.backgroundColor = 'var(--reference-background)';
            referenceElement.style.borderLeft = '3px solid var(--reference-border)';
            
            // Format reference with markdown
            try {
                referenceElement.innerHTML = parseMarkdown(message.text);
                referenceElement.classList.add('markdown-content');
                
                // Add syntax highlighting to code blocks if any
                const codeBlocks = referenceElement.querySelectorAll('pre code');
                if (codeBlocks.length > 0) {
                    highlightCodeBlocks(codeBlocks);
                    
                    // Add copy button to code blocks
                    addCodeBlockActionButtons(referenceElement);
                }
                
                // Add a small label to indicate this is a reference
                const referenceLabel = document.createElement('div');
                referenceLabel.style.fontSize = '10px';
                referenceLabel.style.textTransform = 'uppercase';
                referenceLabel.style.opacity = '0.7';
                referenceLabel.style.marginBottom = '4px';
                referenceLabel.style.fontWeight = 'bold';
                referenceLabel.textContent = 'Reference';
                
                // Insert the label at the beginning
                referenceElement.insertBefore(referenceLabel, referenceElement.firstChild);
                
                // Add option to use this reference in the next prompt
                const useButton = document.createElement('button');
                useButton.className = 'reference-use-button';
                useButton.style.fontSize = '11px';
                useButton.style.padding = '3px 8px';
                useButton.style.marginTop = '8px';
                useButton.textContent = 'Use in Prompt';
                useButton.addEventListener('click', () => {
                    // Get current text in prompt input
                    const currentText = promptInput.value;
                    
                    // Extract just the reference content (from third line to the end)
                    const lines = message.text.split('\n');
                    const referenceContent = lines.slice(1).join('\n');
                    
                    // Add to prompt with formatting
                    if (currentText && currentText.trim()) {
                        promptInput.value = currentText + '\n\nReference:\n' + referenceContent;
                    } else {
                        promptInput.value = 'Please analyze this code:\n\n' + referenceContent;
                    }
                    
                    // Resize and focus
                    autoResizeTextarea();
                    promptInput.focus();
                    
                    // Scroll to the input
                    promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                
                // Add the use button
                referenceElement.appendChild(useButton);
                
            } catch (e) {
                console.error('Error formatting reference:', e);
                referenceElement.textContent = message.text;
            }
            
            // Add to the chat container
            chatContainer.appendChild(referenceElement);
            
            // Scroll to show the reference
            setTimeout(() => {
                smoothScrollToBottom();
            }, 100);
            break;
    }
});

// Set the textarea to auto-resize initially
autoResizeTextarea();

// Initialize by requesting relevant data
vscode.postMessage({ command: 'getProjectContext' });
vscode.postMessage({ command: 'getSessions' });
vscode.postMessage({ command: 'getModels' });