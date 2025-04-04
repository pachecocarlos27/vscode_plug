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

// Helper function to extract clean code from a code block
function extractCleanCodeFromBlock(codeBlock) {
    try {
        // Get the raw HTML as a starting point
        const originalHtml = codeBlock.innerHTML || '';
        console.log("Raw code block HTML:", originalHtml);
        
        // Remove all HTML tags to get clean text
        let cleanCode = originalHtml
            .replace(/<div[^>]*class="line"[^>]*>/g, '')     // Remove line div starts with any attributes
            .replace(/<\/div>/g, '\n')                       // Replace line div ends with newlines
            .replace(/<span[^>]*class="token[^"]*"[^>]*>|<\/span>/g, '')  // Remove all token spans
            .replace(/"token [^"]+"/g, '')                   // Remove token attr-name references
            .replace(/class="line"/g, '')                    // Remove line class attributes
            .replace(/data-line-number="[^"]*"/g, '')        // Remove line number attributes
            .replace(/class="[^"]*"/g, '')                   // Remove all remaining class attributes
            .replace(/"token attr-name">/g, '')              // Remove token attr-name (without class=)
            .replace(/&lt;/g, '<')                           // Replace HTML entities
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        
        console.log("Cleaned code (first attempt):", cleanCode);
        
        // If we still have HTML issues, try even more aggressive cleaning
        if (cleanCode.includes('<') && (cleanCode.includes('span') || cleanCode.includes('div') || cleanCode.includes('token'))) {
            // First try to remove any remaining HTML tags entirely
            cleanCode = cleanCode.replace(/<[^>]*>/g, ''); 
            
            // If still problematic, use DOM parsing as fallback
            if (cleanCode.includes('<') && (cleanCode.includes('span') || cleanCode.includes('div'))) {
                // Use DOMParser for safer HTML parsing
                const parser = new DOMParser();
                const doc = parser.parseFromString(originalHtml, 'text/html');
                cleanCode = doc.body.textContent || '';
                console.log("Using textContent fallback:", cleanCode);
            }
        }
        
        // Final cleanup - trim each line and ensure proper line endings
        cleanCode = cleanCode.split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
        
        console.log("Final cleaned code:", cleanCode);
        return cleanCode;
    } catch (e) {
        console.error('Error extracting clean code:', e);
        // Absolute fallback - use textContent
        const fallbackCode = codeBlock.textContent || '';
        console.log("Error fallback code:", fallbackCode);
        return fallbackCode;
    }
}

// Handler for code block UI enhancements
function setupCodeBlockInteractions() {
    // Set up keyboard shortcuts for code blocks
    document.addEventListener('keydown', function(event) {
        // Only activate shortcuts when the chat input is not focused
        if (document.activeElement === promptInput) {
            return;
        }
        
        // Check if we're inside a code block - find nearest pre element to active element
        const isInCodeBlock = event.target.closest('pre') || 
            document.activeElement.closest('pre');
        
        if (isInCodeBlock) {
            // Code navigation shortcuts
            if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
                // Ctrl+C or Cmd+C - Copy current code block or selection
                event.preventDefault();
                
                const selectedText = window.getSelection().toString();
                if (selectedText) {
                    // Copy selection
                    vscode.postMessage({
                        command: 'copyToClipboard',
                        text: selectedText
                    });
                } else {
                    // Copy entire code block
                    const codeBlock = isInCodeBlock.querySelector('code');
                    if (codeBlock) {
                        const code = extractCleanCodeFromBlock(codeBlock);
                        vscode.postMessage({
                            command: 'copyToClipboard',
                            text: code
                        });
                    }
                }
                
                // Show visual feedback
                isInCodeBlock.style.boxShadow = '0 0 0 2px var(--vscode-button-background)';
                setTimeout(() => {
                    isInCodeBlock.style.boxShadow = '';
                }, 500);
            }
        }
    });
    // Use event delegation to handle clicks on code elements
    document.addEventListener('click', function(event) {
        // CASE 1: Handle quick copy button (pre::after element)
        const preElement = event.target.closest('pre');
        if (preElement) {
            // Check if the click is in the top-left part of the pre (where the copy all button would be)
            const rect = preElement.getBoundingClientRect();
            const clickX = event.clientX;
            const clickY = event.clientY;
            
            // If the click is within the top-left corner area
            if (clickX < rect.left + 80 && clickY < rect.top + 25) {
                const codeBlock = preElement.querySelector('code');
                if (codeBlock) {
                    const code = extractCleanCodeFromBlock(codeBlock);
                    console.log(`Quick copying entire code block (${code.length} chars)`);
                    
                    // Copy the code to clipboard
                    vscode.postMessage({
                        command: 'copyToClipboard',
                        text: code
                    });
                    
                    // Show visual feedback
                    preElement.style.boxShadow = '0 0 0 2px var(--vscode-button-background)';
                    setTimeout(() => {
                        preElement.style.boxShadow = '';
                    }, 500);
                    
                    // Prevent further handling
                    return;
                }
            }
        }
        
        // CASE 2: Handle line copy clicks
        const line = event.target.closest('.line');
        if (line) {
            // Check if the click is in the right part of the line (where the copy icon would be)
            const rect = line.getBoundingClientRect();
            const clickX = event.clientX;
            
            // If the click is within 30px of the right edge of the line
            if (clickX > rect.right - 30) {
                const lineContent = line.textContent || '';
                console.log(`Copying line ${line.dataset.lineNumber}: ${lineContent}`);
                
                // Copy the line content to clipboard
                vscode.postMessage({
                    command: 'copyToClipboard',
                    text: lineContent
                });
                
                // Show visual feedback
                const originalBackground = line.style.backgroundColor;
                line.style.backgroundColor = 'rgba(80, 220, 100, 0.2)';
                setTimeout(() => {
                    line.style.backgroundColor = originalBackground;
                }, 500);
            }
        }
    });
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', setupCodeBlockInteractions);

// Add action buttons to code blocks
function addCodeBlockActionButtons(element) {
    console.log(`Adding code action buttons to element:`, element);
    
    // Find all code blocks
    const codeBlocks = element.querySelectorAll('pre code');
    console.log(`Found ${codeBlocks.length} code blocks`);
    
    if (!codeBlocks.length) return;
    
    // Process each code block
    codeBlocks.forEach((codeBlock, index) => {
        console.log(`Processing code block ${index}:`, codeBlock);
        
        const preElement = codeBlock.parentElement;
        if (!preElement) {
            console.warn(`No parent element found for code block ${index}`);
            return;
        }
        
        // Skip if we already added buttons to this block
        if (preElement.querySelector('.code-actions')) {
            console.log(`Buttons already added to code block ${index}`);
            return;
        }
        
        // Create action buttons container
        const actionContainer = document.createElement('div');
        actionContainer.className = 'code-actions';
        
        // Add Copy button
        const copyButton = document.createElement('button');
        copyButton.textContent = '';
        copyButton.className = 'code-action-button';
        // Add copy icon
        const copyIcon = document.createElement('span');
        copyIcon.innerHTML = '📋'; // Unicode clipboard icon
        copyIcon.style.marginRight = '4px';
        copyButton.appendChild(copyIcon);
        copyButton.appendChild(document.createTextNode('Copy'));
        copyButton.addEventListener('click', () => {
            // Get the code text using our clean extraction method
            let code = extractCleanCodeFromBlock(codeBlock);
            
            // Copy to clipboard using VS Code's clipboard
            vscode.postMessage({
                command: 'copyToClipboard',
                text: code
            });
            
            // Show feedback
            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = '✓ Copied!';
            setTimeout(() => {
                copyButton.innerHTML = originalHTML;
            }, 2000);
        });
        
        // Add Save to File button
        const saveButton = document.createElement('button');
        saveButton.textContent = '';
        saveButton.className = 'code-action-button';
        
        // Add save icon
        const saveIcon = document.createElement('span');
        saveIcon.innerHTML = '💾'; // Unicode save icon
        saveIcon.style.marginRight = '4px';
        saveButton.appendChild(saveIcon);
        saveButton.appendChild(document.createTextNode('Save as File'));
        saveButton.addEventListener('click', () => {
            // Get the code text using our clean extraction method
            let code = extractCleanCodeFromBlock(codeBlock);
            
            // Get language from the code block
            const language = codeBlock.className.replace('language-', '').trim();
            
            console.log(`Save button clicked, sending code (${code.length} chars) with language: ${language}`);
            
            // Send to VS Code to save as a file - no confirmation needed in production
            {
                // Send to VS Code to save as a file
                vscode.postMessage({
                    command: 'saveCodeToFile',
                    text: code,
                    language: language
                });
                
                // Show temporary feedback
                const originalHTML = saveButton.innerHTML;
                saveButton.innerHTML = '⏳ Saving...';
                setTimeout(() => {
                    saveButton.innerHTML = originalHTML;
                }, 2000);
                
                console.log("Save request sent to VS Code extension");
            }
        });
        
        // Add Apply button (for code changes)
        const applyButton = document.createElement('button');
        applyButton.textContent = '';
        applyButton.className = 'code-action-button';
        
        // Add apply icon
        const applyIcon = document.createElement('span');
        applyIcon.innerHTML = '✏️'; // Unicode edit icon
        applyIcon.style.marginRight = '4px';
        applyButton.appendChild(applyIcon);
        applyButton.appendChild(document.createTextNode('Apply to Editor'));
        applyButton.addEventListener('click', () => {
            // Get the code text using our clean extraction method
            let code = extractCleanCodeFromBlock(codeBlock);
            
            console.log(`Apply to Editor clicked for block ${index}, code length: ${code.length}`);
            console.log(`Code sample: ${code.substring(0, Math.min(50, code.length))}...`);
            
            if (!code || code.trim() === '') {
                console.error("Cannot apply empty code to editor");
                alert("Cannot apply empty code to editor");
                return;
            }
            
            try {
                // Send to VS Code to apply to the current file
                console.log(`CRITICAL: Sending code to editor. Length=${code.length}, First 30 chars: ${code.substring(0, 30)}`);
                
                // Create and show debug message
                const debugMsg = document.createElement('div');
                debugMsg.style.color = 'red';
                debugMsg.style.fontWeight = 'bold';
                debugMsg.textContent = `⚠️ Sending to editor: ${code.length} chars`;
                preElement.parentNode.insertBefore(debugMsg, preElement.nextSibling);
                
                // Send to VSCode
                // Get language from the code block
                const language = codeBlock.className.replace('language-', '').trim();
                console.log(`Language detected for apply to editor: ${language}`);
                
                vscode.postMessage({
                    command: 'applyCodeToEditor',
                    text: code,
                    blockIndex: index,
                    language: language  // Pass the language for file creation
                });
                console.log("Apply to editor message sent to VS Code");
                
                // Show feedback
                const originalHTML = applyButton.innerHTML;
                applyButton.innerHTML = '✓ Applying...';
                
                // Visual feedback
                preElement.style.border = '2px solid #4CAF50';
                setTimeout(() => {
                    preElement.style.border = '1px solid var(--vscode-panel-border, #555)';
                    applyButton.innerHTML = originalHTML;
                }, 2000);
            } catch (error) {
                console.error("Error sending apply code message:", error);
                alert("Error applying code to editor: " + error);
            }
        });
        
        // Add buttons to container
        actionContainer.appendChild(copyButton);
        actionContainer.appendChild(saveButton);
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
    
    // Debug message to console for all messages from extension
    console.log(`Received message from extension: ${message.command}`);
    
    switch (message.command) {
        case 'fileSaved':
            if (message.success) {
                // Show success alert
                alert(`File saved successfully at: ${message.filePath}`);
            } else {
                // Show error alert
                alert(`Error saving file: ${message.error || 'Unknown error'}`);
            }
            break;
            
        case 'setModel':
            modelDisplay.textContent = 'Model: ' + message.model;
            
            // Also update the title indicator
            const titleIndicator = document.getElementById('title-model-indicator');
            if (titleIndicator) {
                titleIndicator.textContent = message.model;
            }
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