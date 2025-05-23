/**
 * Optimized Markdown Parser for Ollama VS Code Extension
 */

// Result cache to avoid reprocessing the same content
const markdownCache = new Map();
const MAX_CACHE_SIZE = 50;

// Parse markdown to HTML with caching
function parseMarkdown(text) {
    // For small text, don't use cache
    if (!text || text.length < 100) {
        return parseMarkdownImpl(text || '');
    }
    
    // Generate a hash for the text
    const hash = hashString(text);
    
    // Check cache
    if (markdownCache.has(hash)) {
        return markdownCache.get(hash);
    }
    
    // Parse the markdown
    const result = parseMarkdownImpl(text);
    
    // Cache management
    if (markdownCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = markdownCache.keys().next().value;
        markdownCache.delete(oldestKey);
    }
    markdownCache.set(hash, result);
    
    return result;
}

// Simple hash function for strings
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash); // Return positive integer
}

// Markdown parsing implementation
function parseMarkdownImpl(text) {
    if (!text || !text.trim()) {
        return '';
    }
    
    // Process code blocks with enhanced formatting
    // Optimized regex to handle different code block formats - more permissive with spacing
    let parsed = text.replace(/```(\w*)\s*([\s\S]*?)```/g, function(match, language, code) {
        const lang = language || '';
        const displayLang = lang || 'text';
        
        // Normalize line endings and handle whitespace consistently
        const normalizedCode = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        
        // Process code to add line numbers - using map for better performance
        const lineNumberedCode = normalizedCode.split('\n')
            .map((line, index) => {
                // Escape HTML and clean in a single pass for better performance
                const cleanLine = line
                    .replace(/[<>&]/g, c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;')
                    .replace(/<\/?(?:span|div)[^>]*>|data-(?:line-number|language)="[^"]*"|"token[^"]*"|class="[^"]*"/g, '');
                
                return `<div class="line" data-line-number="${index+1}">${cleanLine}</div>`;
            })
            .join('');
        
        // Return enhanced code block with language label
        return `<pre data-language="${displayLang}"><code class="language-${lang}">${lineNumberedCode}</code></pre>`;
    });
    
    // Replace inline code
    parsed = parsed.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Process headers
    parsed = parsed.replace(/^###### (.*?)$/gm, '<h6>$1</h6>');
    parsed = parsed.replace(/^##### (.*?)$/gm, '<h5>$1</h5>');
    parsed = parsed.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    parsed = parsed.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    parsed = parsed.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    parsed = parsed.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    
    // Handle formatting
    parsed = parsed.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<em><strong>$1</strong></em>');
    parsed = parsed.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    parsed = parsed.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    
    // Handle blockquotes
    parsed = parsed.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    
    // Handle links
    parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Handle ordered lists
    parsed = parsed.replace(/^(\d+)\. (.*?)$/gm, '<ol start="$1"><li>$2</li></ol>');
    
    // Handle unordered lists
    parsed = parsed.replace(/^[\*-] (.*?)$/gm, '<ul><li>$1</li></ul>');
    
    // Consolidate lists
    parsed = parsed.replace(/<\/ul>\s*<ul>/g, '');
    parsed = parsed.replace(/<\/ol>\s*<ol[^>]*>/g, '');
    
    // Add paragraphs
    const lines = parsed.split('\n');
    let inParagraph = false;
    let inCodeBlock = false;
    let result = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Check if line is a special block
        const isSpecialBlock = 
            trimmedLine.startsWith('<h') || 
            trimmedLine.startsWith('<ul') || 
            trimmedLine.startsWith('<ol') || 
            trimmedLine.startsWith('<blockquote') ||
            trimmedLine.startsWith('<pre');
        
        // Handle code blocks
        if (line.includes('<pre>') || line.includes('<pre><code')) {
            inCodeBlock = true;
        }
        if (line.includes('</pre>')) {
            inCodeBlock = false;
        }
        
        if (isSpecialBlock || inCodeBlock || trimmedLine === '') {
            // Close paragraph if open
            if (inParagraph) {
                result += '</p>\n';
                inParagraph = false;
            }
            result += line + '\n';
        } else {
            // Regular text line
            if (!inParagraph) {
                result += '<p>';
                inParagraph = true;
            } else {
                result += '<br>';
            }
            result += line;
            
            // Check if paragraph should end
            const nextLine = i < lines.length - 1 ? lines[i+1].trim() : '';
            if (i === lines.length - 1 || 
                nextLine.startsWith('<h') || 
                nextLine.startsWith('<ul') || 
                nextLine.startsWith('<ol') || 
                nextLine.startsWith('<blockquote') ||
                nextLine.startsWith('<pre') ||
                nextLine === '') {
                result += '</p>\n';
                inParagraph = false;
            }
        }
    }
    
    // Close any open paragraph
    if (inParagraph) {
        result += '</p>';
    }
    
    return result;
}

// Enhanced syntax highlighting in batches
function highlightCodeBlocks(codeElements) {
    if (!codeElements || codeElements.length === 0) return;
    
    // Process in batches
    const processBatch = (startIdx = 0, batchSize = 5) => {
        const endIdx = Math.min(startIdx + batchSize, codeElements.length);
        
        for (let i = startIdx; i < endIdx; i++) {
            const block = codeElements[i];
            if (!block || !block.className) continue;
            
            const lang = block.className.replace('language-', '');
            let code = block.innerHTML || '';
            
            // First ensure we clean any existing token formatting or class attributes
            // to prevent duplication of token spans or conflicting attributes
            code = code.replace(/<span[^>]*class="token[^"]*"[^>]*>|<\/span>/g, '');  // Remove token spans
            code = code.replace(/"token [^"]+"/g, '');                                // Remove token attributes
            code = code.replace(/class="[^"]*token[^"]*"/g, '');                      // Remove class with token
            
            // Skip empty or already highlighted blocks
            if (!code || code.includes('token')) continue;
            
            // Set language display on the parent pre element
            const preElement = block.parentElement;
            if (preElement && preElement.tagName === 'PRE') {
                if (!preElement.hasAttribute('data-language')) {
                    preElement.setAttribute('data-language', lang || 'text');
                }
            }
            
            // We don't need to sanitize code here as it should already be sanitized
            // when the code blocks were processed
            
            // Apply language-specific highlighting
            if (lang === 'js' || lang === 'javascript' || lang === 'ts' || lang === 'typescript') {
                // Keywords
                code = code.replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|interface|extends|implements|new|this|typeof|instanceof|try|catch|throw|finally|async|await|import|export|from|default)\b/g, 
                    '<span class="token keyword">$1</span>');
                
                // Strings
                code = code.replace(/('(?:\\.|[^\\'])*')|("(?:\\.|[^\\"])*")/g, 
                    '<span class="token string">$&</span>');
                
                // Template literals
                code = code.replace(/(`(?:\\.|[^\\`])*`)/g, 
                    '<span class="token string">$&</span>');
                
                // Numbers
                code = code.replace(/\b(0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?)\b/gi, 
                    '<span class="token number">$1</span>');
                
                // Booleans
                code = code.replace(/\b(true|false|null|undefined)\b/g, 
                    '<span class="token boolean">$1</span>');
                
                // Comments
                code = code.replace(/(\/\/[^\n\r]*)|(\/\*[\s\S]*?\*\/)/g, 
                    '<span class="token comment">$&</span>');
                    
                // Functions
                code = code.replace(/([a-zA-Z_$][\w$]*)(?=\s*\()/g, 
                    '<span class="token function">$1</span>');
            }
            else if (lang === 'py' || lang === 'python') {
                // Keywords
                code = code.replace(/\b(def|class|import|from|as|if|elif|else|for|while|try|except|finally|with|return|yield|break|continue|pass|in|is|not|and|or|True|False|None|lambda|global|nonlocal)\b/g, 
                    '<span class="token keyword">$1</span>');
                
                // Strings
                code = code.replace(/("""[\s\S]*?""")|('''[\s\S]*?''')/g, 
                    '<span class="token string">$&</span>');
                code = code.replace(/('(?:\\.|[^\\'])*')|("(?:\\.|[^\\"])*")/g, 
                    '<span class="token string">$&</span>');
                
                // Numbers
                code = code.replace(/\b(0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?)\b/gi, 
                    '<span class="token number">$1</span>');
                
                // Comments
                code = code.replace(/(#[^\n\r]*)/g, 
                    '<span class="token comment">$1</span>');
                
                // Decorators
                code = code.replace(/(@[\w.]+)/g,
                    '<span class="token decorator">$1</span>');
                    
                // Functions
                code = code.replace(/([a-zA-Z_][\w]*)(?=\s*\()/g, 
                    '<span class="token function">$1</span>');
            }
            else if (lang === 'html' || lang === 'xml') {
                // Make sure there are no existing spans or tokens first
                code = code.replace(/<span[^>]*>|<\/span>/g, '');
                code = code.replace(/"token [^"]+"/g, '');
                
                // Tags - use a more specific regex to avoid matching token spans
                code = code.replace(/(&lt;\/?)([\w:-]+)(?![^<>]*"token)/g, 
                    '$1<span class="token tag">$2</span>');
                
                // Attributes - more specific to avoid nested matches
                code = code.replace(/\s+([\w:-]+)(?=\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))(?![^<>]*"token)/g,
                    ' <span class="token attr-name">$1</span>');
                
                // Values
                code = code.replace(/=\s*(["'])([\s\S]*?)\1(?![^<>]*"token)/g,
                    '=<span class="token attr-value">$1$2$1</span>');
                
                // Comments
                code = code.replace(/(&lt;!--[\s\S]*?--&gt;)(?![^<>]*"token)/g,
                    '<span class="token comment">$1</span>');
            }
            
            block.innerHTML = code;
        }
        
        // Continue with next batch if needed
        if (endIdx < codeElements.length) {
            setTimeout(() => processBatch(endIdx, batchSize), 1);
        }
    };
    
    // Start processing
    processBatch();
}