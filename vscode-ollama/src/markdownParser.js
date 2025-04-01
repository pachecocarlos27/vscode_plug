/**
 * Simple Markdown Parser for Ollama VS Code Extension
 * 
 * This file contains functions to parse markdown text into HTML
 * and apply syntax highlighting to code blocks
 */

// Parse markdown to HTML
function parseMarkdown(text) {
    // Replace all occurrences of ``` code blocks 
    let parsed = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, language, code) {
        const lang = language || '';
        return '<pre><code class="language-' + lang + '">' + 
               code.replace(/</g, '&lt;').replace(/>/g, '&gt;') + 
               '</code></pre>';
    });
    
    // Replace inline code blocks
    parsed = parsed.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers (h1 to h6)
    parsed = parsed.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    parsed = parsed.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    parsed = parsed.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    parsed = parsed.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    parsed = parsed.replace(/^##### (.*?)$/gm, '<h5>$1</h5>');
    parsed = parsed.replace(/^###### (.*?)$/gm, '<h6>$1</h6>');
    
    // Handle bold and italic
    parsed = parsed.replace(/\*\*\*([^\*]+)\*\*\*/g, '<em><strong>$1</strong></em>');
    parsed = parsed.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    
    // Handle underline and strikethrough
    parsed = parsed.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Handle blockquotes
    parsed = parsed.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    
    // Handle links
    parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Handle ordered lists
    parsed = parsed.replace(/^(\d+)\. (.*?)$/gm, '<ol start="$1"><li>$2</li></ol>');
    
    // Handle unordered lists - match a line starting with "- " or "* " 
    parsed = parsed.replace(/^[\*-] (.*?)$/gm, '<ul><li>$1</li></ul>');
    
    // Consolidate adjacent list items
    parsed = parsed.replace(/<\/ul>\s*<ul>/g, '');
    parsed = parsed.replace(/<\/ol>\s*<ol[^>]*>/g, '');
    
    // Add paragraphs to text blocks
    const lines = parsed.split('\n');
    let inParagraph = false;
    let inList = false;
    let inBlockquote = false;
    let inCodeBlock = false;
    let result = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if line is a heading, list, blockquote or code block
        const isSpecialBlock = line.startsWith('<h') || 
                              line.startsWith('<ul') || 
                              line.startsWith('<ol') || 
                              line.startsWith('<blockquote') ||
                              line.startsWith('<pre');
        
        // Handle multi-line code blocks
        if (line.includes('<pre>') || line.includes('<pre><code')) {
            inCodeBlock = true;
        }
        if (line.includes('</pre>')) {
            inCodeBlock = false;
        }
        
        // We don't wrap special blocks or empty lines in paragraphs
        if (isSpecialBlock || inCodeBlock || line.trim() === '') {
            // If we were in a paragraph, close it
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
                // If we're already in a paragraph, add a <br> for line breaks
                result += '<br>';
            }
            result += line;
            
            // If this is the last line or next line is a special block, close paragraph
            if (i === lines.length - 1 || 
                lines[i+1].startsWith('<h') || 
                lines[i+1].startsWith('<ul') || 
                lines[i+1].startsWith('<ol') || 
                lines[i+1].startsWith('<blockquote') ||
                lines[i+1].startsWith('<pre') ||
                lines[i+1].trim() === '') {
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

// Simple syntax highlighting function
function highlightCodeBlocks(codeElements) {
    codeElements.forEach(block => {
        const lang = block.className.replace('language-', '');
        let code = block.innerHTML;
        
        // Apply basic syntax highlighting based on language
        if (lang === 'js' || lang === 'javascript' || lang === 'ts' || lang === 'typescript') {
            // Keywords
            code = code.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|extends|new|this|typeof|try|catch|throw|async|await)\b/g, 
                             '<span class="token keyword">$1</span>');
            
            // Strings
            code = code.replace(/("[^"]*")|('[^']*')|(`[^`]*`)/g, 
                             '<span class="token string">$&</span>');
            
            // Numbers
            code = code.replace(/\b(\d+(\.\d+)?)\b/g, 
                             '<span class="token number">$1</span>');
            
            // Booleans
            code = code.replace(/\b(true|false|null|undefined)\b/g, 
                             '<span class="token boolean">$1</span>');
            
            // Comments
            code = code.replace(/(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/g, 
                             '<span class="token comment">$&</span>');
                             
            // Functions
            code = code.replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, 
                             '<span class="token function">$1</span>(');
        }
        else if (lang === 'py' || lang === 'python') {
            // Keywords
            code = code.replace(/\b(def|class|import|from|as|if|elif|else|for|while|try|except|finally|with|return|yield|break|continue|pass|in|is|not|and|or|True|False|None)\b/g, 
                             '<span class="token keyword">$1</span>');
            
            // Strings
            code = code.replace(/("[^"]*")|('[^']*')|(`[^`]*`)|("""[\s\S]*?""")|('''[\s\S]*?''')/g, 
                             '<span class="token string">$&</span>');
            
            // Numbers
            code = code.replace(/\b(\d+(\.\d+)?)\b/g, 
                             '<span class="token number">$1</span>');
            
            // Comments
            code = code.replace(/(#[^\n]*)/g, 
                             '<span class="token comment">$1</span>');
                             
            // Functions
            code = code.replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, 
                             '<span class="token function">$1</span>(');
        }
        
        block.innerHTML = code;
    });
}