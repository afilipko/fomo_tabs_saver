// content-tagger.js - URL content classification using local pattern matching

class ContentTagger {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return true;

    // No external dependencies to load - everything is local
    this.isInitialized = true;
    return true;
  }

  async tagUrl(url, title, tabId = null) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Extract domain and path for analysis
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname;

      // Try to get rich metadata from the page via content script
      let metadata = null;
      let enhancedCategories = [];

      if (tabId) {
        try {
          // Skip system URLs that we can't access
          if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('moz-extension://')) {
            console.log(`Skipping metadata extraction for system URL: ${url}`);
          } else {
            console.log(`Attempting to get metadata for tab ${tabId}: ${url}`);

            // First check if content script is already available
            let contentScriptReady = false;
            try {
              const testResponse = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
              contentScriptReady = testResponse === 'pong';
              console.log(`Content script already available for tab ${tabId}: ${contentScriptReady}`);
            } catch (e) {
              console.log(`Content script not available for tab ${tabId}, will try to inject`);
            }

            // If content script not ready, try injection or reload
            if (!contentScriptReady) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['content-script.js']
                });
                console.log(`Content script injected for tab ${tabId}`);
                await new Promise(resolve => setTimeout(resolve, 200));
              } catch (injectionError) {
                console.warn(`Content script injection failed for tab ${tabId} ${url}:`, injectionError);

                // Try reloading the tab to enable content script
                console.log(`Attempting to reload tab ${tabId} to enable content script`);
                try {
                  await chrome.tabs.reload(tabId);
                  console.log(`Tab ${tabId} reloaded, waiting for page load...`);

                  // Wait for page to load and content script to initialize
                  await this.waitForTabLoad(tabId);
                  await new Promise(resolve => setTimeout(resolve, 500));

                  console.log(`Tab ${tabId} should now have content script available`);
                } catch (reloadError) {
                  console.error(`Failed to reload tab ${tabId}:`, reloadError);
                  return; // Skip this tab
                }
              }
            }

            // Now try to get metadata
            const response = await chrome.tabs.sendMessage(tabId, { action: 'getMetadata' });

            console.log(`Response from tab ${tabId}:`, response);

            if (response && response.success) {
              metadata = response.metadata;
              enhancedCategories = response.categories || [];
              console.log(`Successfully extracted metadata for ${url}:`, metadata);
            } else {
              console.warn(`No valid response from content script for ${url}`);
            }
          }
        } catch (contentScriptError) {
          console.warn(`Could not get metadata from content script for ${url}:`, contentScriptError.message || contentScriptError);
        }
      }

      // Prepare text for classification - use rich metadata if available
      let textToClassify;
      if (metadata && metadata.description) {
        // Use og:description and other rich metadata for better classification
        textToClassify = [
          title,
          metadata.description,
          domain,
          ...(metadata.keywords || []).slice(0, 5), // Limit keywords
          metadata.ogData?.type,
          metadata.ogData?.site_name,
          ...(metadata.headings?.h1 || []).slice(0, 2) // First 2 H1s
        ].filter(Boolean).join(' ').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
      } else {
        // Fallback to basic URL and title
        textToClassify = `${title} ${domain} ${path}`.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
      }

      // Perform comprehensive classification
      const classificationResult = await this.classifyWithConfidence(textToClassify, metadata, url, title, enhancedCategories);

      // Enhanced tagging with metadata
      const tags = this.generateEnhancedTags(url, title, classificationResult.finalCategories, metadata);

      return {
        url: url,
        title: title,
        categories: classificationResult.finalCategories.length > 0 ? classificationResult.finalCategories : ['general'],
        confidence: classificationResult.confidence,
        classification: {
          local: classificationResult.localCategories,
          pattern: classificationResult.patternCategories,
          schema: classificationResult.schemaCategories,
          metadata: classificationResult.metadataCategories
        },
        domain: domain,
        tags: tags,
        description: metadata?.description || null,
        image: this.extractImageUrl(metadata),
        author: metadata?.author || null,
        publishedDate: metadata?.publishedDate || null,
        wordCount: metadata?.articleData?.wordCount || null,
        language: metadata?.lang || null,
        classificationText: textToClassify.substring(0, 200) // For debugging
      };
    } catch (error) {
      console.error('Error tagging URL:', error);
      const fallbackCategories = this.categorizeByUrl(url, title);
      return {
        url: url,
        title: title,
        categories: fallbackCategories,
        confidence: 0.3, // Low confidence for fallback
        classification: {
          local: [],
          pattern: fallbackCategories,
          schema: [],
          metadata: []
        },
        domain: new URL(url).hostname,
        tags: this.generateTags(url, title, fallbackCategories),
        description: null,
        image: null,
        author: null,
        publishedDate: null,
        wordCount: null,
        language: null
      };
    }
  }

  // Lightweight local text classification using TF-IDF-like approach
  localTextClassification(text) {
    const categories = {
      'technology': {
        patterns: ['api', 'software', 'code', 'programming', 'developer', 'tech', 'app', 'digital', 'system', 'algorithm', 'data', 'framework', 'library', 'database', 'server', 'cloud', 'ai', 'ml', 'javascript', 'python', 'java', 'react', 'vue', 'angular', 'docker', 'kubernetes'],
        weight: 1.0
      },
      'news': {
        patterns: ['breaking', 'report', 'news', 'update', 'latest', 'today', 'announces', 'statement', 'press', 'media', 'journalist', 'article', 'story', 'headline', 'coverage', 'reuters', 'cnn', 'bbc'],
        weight: 1.0
      },
      'business': {
        patterns: ['company', 'business', 'market', 'revenue', 'profit', 'startup', 'enterprise', 'corporate', 'industry', 'finance', 'investment', 'funding', 'ipo', 'merger', 'acquisition', 'forbes', 'bloomberg'],
        weight: 0.9
      },
      'education': {
        patterns: ['learn', 'course', 'tutorial', 'guide', 'education', 'training', 'lesson', 'study', 'university', 'school', 'student', 'teacher', 'professor', 'academic', 'research', 'coursera', 'udemy'],
        weight: 0.9
      },
      'entertainment': {
        patterns: ['movie', 'music', 'video', 'game', 'entertainment', 'show', 'series', 'film', 'streaming', 'watch', 'play', 'fun', 'comedy', 'drama', 'action', 'youtube', 'netflix', 'spotify'],
        weight: 0.8
      },
      'science': {
        patterns: ['research', 'study', 'scientific', 'discovery', 'experiment', 'analysis', 'hypothesis', 'theory', 'science', 'biology', 'chemistry', 'physics', 'astronomy', 'nature', 'arxiv'],
        weight: 0.9
      },
      'health': {
        patterns: ['health', 'medical', 'doctor', 'treatment', 'wellness', 'fitness', 'medicine', 'patient', 'care', 'hospital', 'clinic', 'therapy', 'nutrition', 'webmd', 'mayo'],
        weight: 0.8
      },
      'finance': {
        patterns: ['finance', 'money', 'investment', 'banking', 'crypto', 'trading', 'stock', 'financial', 'economy', 'bitcoin', 'ethereum', 'currency', 'forex', 'coinbase', 'binance'],
        weight: 0.8
      },
      'lifestyle': {
        patterns: ['lifestyle', 'fashion', 'travel', 'food', 'recipe', 'design', 'home', 'decoration', 'beauty', 'wellness', 'personal', 'hobby', 'pinterest'],
        weight: 0.7
      },
      'sports': {
        patterns: ['sport', 'football', 'basketball', 'soccer', 'athlete', 'game', 'match', 'tournament', 'team', 'player', 'championship', 'league', 'espn'],
        weight: 0.8
      },
      'shopping': {
        patterns: ['shop', 'buy', 'store', 'product', 'cart', 'checkout', 'price', 'deal', 'amazon', 'ebay', 'retail', 'marketplace', 'purchase'],
        weight: 0.8
      },
      'social': {
        patterns: ['twitter', 'facebook', 'linkedin', 'instagram', 'reddit', 'discord', 'social', 'community', 'forum', 'discussion', 'post', 'share'],
        weight: 0.7
      }
    };

    const textLower = text.toLowerCase();
    const words = textLower.split(/\s+/);
    const results = [];

    // Calculate relevance scores for each category
    Object.entries(categories).forEach(([category, data]) => {
      let score = 0;
      let matches = 0;

      data.patterns.forEach(pattern => {
        // Exact word matches get higher score
        if (words.includes(pattern)) {
          score += 2 * data.weight;
          matches++;
        }
        // Partial matches get lower score
        else if (textLower.includes(pattern)) {
          score += 1 * data.weight;
          matches++;
        }
      });

      // Normalize score by pattern count and text length
      const normalizedScore = (score / data.patterns.length) * (matches / Math.max(words.length / 10, 1));

      if (normalizedScore > 0.05) {
        results.push({
          category,
          score: normalizedScore,
          matches
        });
      }
    });

    // Sort by score and return confidence
    results.sort((a, b) => b.score - a.score);
    const topScore = results[0]?.score || 0;

    return {
      categories: results.slice(0, 3).map(r => r.category),
      confidence: Math.min(topScore * 2, 1.0), // Boost confidence, cap at 1.0
      matches: results[0]?.matches || 0
    };
  }

  async classifyWithConfidence(textToClassify, metadata, url, title, enhancedCategories) {
    const result = {
      localCategories: [],
      patternCategories: [],
      schemaCategories: [],
      metadataCategories: enhancedCategories || [],
      finalCategories: [],
      confidence: 0
    };

    // 1. Local classification (highest weight)
    try {
      const localResult = this.localTextClassification(textToClassify);
      result.localCategories = localResult.categories;
      if (result.localCategories.length > 0) {
        result.confidence += 0.5 * localResult.confidence;
      }
    } catch (error) {
      console.warn('Local classification failed:', error);
    }

    // 2. Pattern-based classification
    result.patternCategories = this.categorizeByUrl(url, title);
    if (result.patternCategories.length > 0 && !result.patternCategories.includes('general')) {
      result.confidence += 0.3;
    }

    // 3. Schema.org classification
    if (metadata?.schemaData) {
      result.schemaCategories = this.extractCategoriesFromSchema(metadata.schemaData);
      if (result.schemaCategories.length > 0) {
        result.confidence += 0.2;
      }
    }

    // 4. Combine all classifications with weighted priority
    const allCategories = new Set();

    // Local gets highest priority
    result.localCategories.forEach(cat => allCategories.add(cat));

    // Schema categories get second priority
    result.schemaCategories.forEach(cat => allCategories.add(cat));

    // Metadata categories from content script
    result.metadataCategories.forEach(cat => allCategories.add(cat));

    // Pattern categories as fallback
    if (allCategories.size === 0) {
      result.patternCategories.forEach(cat => allCategories.add(cat));
    } else {
      // Add pattern categories that don't conflict
      result.patternCategories.forEach(cat => {
        if (cat !== 'general') allCategories.add(cat);
      });
    }

    result.finalCategories = Array.from(allCategories).slice(0, 4); // Limit to 4 categories

    // Ensure we always have at least one category
    if (result.finalCategories.length === 0) {
      result.finalCategories = ['general'];
      result.confidence = 0.1;
    }

    return result;
  }

  extractCategoriesFromSchema(schemaData) {
    const categories = new Set();

    // Comprehensive Schema.org type mapping
    const schemaMapping = {
      'NewsArticle': 'news',
      'Article': 'news',
      'BlogPosting': 'news',
      'TechArticle': 'technology',
      'Recipe': 'lifestyle',
      'Course': 'education',
      'EducationalResource': 'education',
      'Product': 'shopping',
      'SoftwareApplication': 'technology',
      'WebApplication': 'technology',
      'VideoObject': 'entertainment',
      'MusicRecording': 'entertainment',
      'Movie': 'entertainment',
      'TVSeries': 'entertainment',
      'Book': 'education',
      'JobPosting': 'business',
      'Event': 'events',
      'SportsEvent': 'sports',
      'MedicalCondition': 'health',
      'Drug': 'health',
      'Exercise': 'health',
      'FinancialProduct': 'finance',
      'InvestmentOrDeposit': 'finance',
      'ScholarlyArticle': 'science',
      'ResearchProject': 'science',
      'Dataset': 'science',
      'SoftwareSourceCode': 'technology',
      'APIReference': 'technology'
    };

    schemaData.forEach(schema => {
      let types = schema['@type'] || schema.type;
      if (!types) return;

      // Handle both single types and arrays
      if (!Array.isArray(types)) {
        types = [types];
      }

      types.forEach(type => {
        if (schemaMapping[type]) {
          categories.add(schemaMapping[type]);
        }
      });
    });

    return Array.from(categories);
  }

  categorizeByUrl(url, title) {
    const categories = [];
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const domain = new URL(url).hostname.toLowerCase();

    // Enhanced categorization patterns with domain-specific logic
    const categoryPatterns = {
      'technology': {
        keywords: ['github', 'stackoverflow', 'codepen', 'jsfiddle', 'codesandbox', 'docs.', 'documentation', 'api', 'programming', 'coding', 'developer', 'software', 'tech', 'ai', 'machine learning', 'blockchain'],
        domains: ['github.com', 'stackoverflow.com', 'techcrunch.com', 'wired.com', 'arstechnica.com'],
        urlPatterns: ['/api/', '/docs/', '/documentation/']
      },
      'news': {
        keywords: ['news', 'article', 'blog', 'post', 'breaking', 'report', 'journalism'],
        domains: ['cnn.com', 'bbc.com', 'reuters.com', 'medium.com', 'substack.com', 'nytimes.com'],
        urlPatterns: ['/news/', '/article/', '/post/']
      },
      'social': {
        keywords: ['twitter', 'facebook', 'linkedin', 'instagram', 'reddit', 'discord', 'social'],
        domains: ['twitter.com', 'facebook.com', 'linkedin.com', 'instagram.com', 'reddit.com', 'discord.com'],
        urlPatterns: ['/profile/', '/user/', '/post/']
      },
      'shopping': {
        keywords: ['amazon', 'shop', 'store', 'buy', 'cart', 'checkout', 'product', 'price', 'deal'],
        domains: ['amazon.com', 'ebay.com', 'shopify.com', 'etsy.com', 'alibaba.com'],
        urlPatterns: ['/product/', '/item/', '/p/', '/shop/']
      },
      'entertainment': {
        keywords: ['youtube', 'netflix', 'video', 'watch', 'movie', 'music', 'game', 'stream', 'entertainment'],
        domains: ['youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'hulu.com'],
        urlPatterns: ['/watch/', '/video/', '/play/']
      },
      'education': {
        keywords: ['course', 'tutorial', 'learn', 'education', 'university', 'coursera', 'udemy', 'study', 'training'],
        domains: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org'],
        urlPatterns: ['/course/', '/learn/', '/tutorial/']
      },
      'business': {
        keywords: ['business', 'startup', 'entrepreneur', 'company', 'corporate', 'enterprise', 'market'],
        domains: ['bloomberg.com', 'wsj.com', 'forbes.com', 'businessinsider.com'],
        urlPatterns: ['/business/', '/company/', '/enterprise/']
      },
      'finance': {
        keywords: ['finance', 'investment', 'trading', 'stock', 'crypto', 'banking', 'fintech', 'money'],
        domains: ['finance.yahoo.com', 'coinbase.com', 'binance.com'],
        urlPatterns: ['/finance/', '/trading/', '/investment/']
      },
      'health': {
        keywords: ['health', 'medical', 'wellness', 'fitness', 'nutrition', 'doctor', 'medicine'],
        domains: ['webmd.com', 'mayoclinic.org', 'healthline.com'],
        urlPatterns: ['/health/', '/medical/', '/wellness/']
      },
      'sports': {
        keywords: ['sport', 'football', 'basketball', 'soccer', 'athlete', 'game', 'match', 'tournament'],
        domains: ['espn.com', 'sports.yahoo.com', 'bleacherreport.com'],
        urlPatterns: ['/sports/', '/game/', '/match/']
      },
      'science': {
        keywords: ['science', 'research', 'study', 'discovery', 'experiment', 'academic', 'scientific'],
        domains: ['nature.com', 'sciencemag.org', 'arxiv.org'],
        urlPatterns: ['/research/', '/study/', '/paper/']
      }
    };

    // Check each category
    Object.entries(categoryPatterns).forEach(([category, patterns]) => {
      const keywordMatch = patterns.keywords.some(keyword =>
        urlLower.includes(keyword) || titleLower.includes(keyword)
      );

      const domainMatch = patterns.domains.some(d => domain.includes(d));

      const urlPatternMatch = patterns.urlPatterns.some(pattern =>
        urlLower.includes(pattern)
      );

      if (keywordMatch || domainMatch || urlPatternMatch) {
        categories.push(category);
      }
    });

    return categories.length > 0 ? categories : ['general'];
  }

  generateTags(url, title, categories) {
    const tags = [...categories];
    const domain = new URL(url).hostname;

    // Add domain-based tags
    if (domain.includes('github')) tags.push('code', 'repository');
    if (domain.includes('stackoverflow')) tags.push('qa', 'programming');
    if (domain.includes('youtube')) tags.push('video', 'streaming');
    if (domain.includes('wikipedia')) tags.push('reference', 'encyclopedia');

    // Add title-based tags
    const titleWords = title.toLowerCase().split(/\s+/);
    const importantWords = titleWords.filter(word =>
      word.length > 3 && !this.isStopWord(word)
    ).slice(0, 3);

    tags.push(...importantWords);

    return [...new Set(tags)]; // Remove duplicates
  }

  generateEnhancedTags(url, title, categories, metadata) {
    const tags = new Set();
    const domain = new URL(url).hostname;

    // 1. Category-based tags
    categories.forEach(cat => {
      if (cat !== 'general') tags.add(cat);
    });

    // 2. Domain-specific tags with expanded coverage
    const domainTags = this.getDomainSpecificTags(domain);
    domainTags.forEach(tag => tags.add(tag));

    // 3. Technical stack detection for development sites
    if (categories.includes('technology')) {
      const techTags = this.detectTechStack(url, title, metadata);
      techTags.forEach(tag => tags.add(tag));
    }

    // 4. Enhanced metadata-based tagging
    if (metadata) {
      // Keywords from meta tags (cleaned and filtered)
      if (metadata.keywords && metadata.keywords.length > 0) {
        const cleanKeywords = metadata.keywords
          .map(k => k.toLowerCase().trim())
          .filter(k => k.length > 2 && !this.isStopWord(k))
          .slice(0, 4);
        cleanKeywords.forEach(tag => tags.add(tag));
      }

      // Site name (cleaned)
      if (metadata.ogData?.site_name) {
        const siteName = metadata.ogData.site_name.toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 15);
        if (siteName.length > 2) tags.add(siteName);
      }

      // Content characteristics
      if (metadata.articleData) {
        if (metadata.articleData.wordCount > 2000) tags.add('in-depth');
        if (metadata.articleData.wordCount > 1000) tags.add('long-read');
        if (metadata.articleData.wordCount < 300) tags.add('short-read');
        if (metadata.articleData.hasArticleTag) tags.add('article');
      }

      // Language
      if (metadata.lang && metadata.lang !== 'en') {
        tags.add(`lang-${metadata.lang}`);
      }

      // Extract semantic keywords from description
      if (metadata.description) {
        const semanticTags = this.extractSemanticTags(metadata.description);
        semanticTags.forEach(tag => tags.add(tag));
      }
    }

    // 5. Title-based semantic extraction
    const titleTags = this.extractSemanticTags(title);
    titleTags.forEach(tag => tags.add(tag));

    // Clean, filter and limit tags
    return Array.from(tags)
      .map(tag => this.cleanTag(tag))
      .filter(tag => tag.length > 1 && tag.length < 20)
      .filter(tag => !this.isStopWord(tag))
      .slice(0, 12); // Increased limit for better coverage
  }

  getDomainSpecificTags(domain) {
    const domainMap = {
      'github.com': ['code', 'repository', 'git', 'opensource'],
      'stackoverflow.com': ['qa', 'programming', 'coding', 'help'],
      'youtube.com': ['video', 'streaming', 'content'],
      'medium.com': ['blog', 'writing', 'publication'],
      'wikipedia.org': ['reference', 'encyclopedia', 'knowledge'],
      'reddit.com': ['discussion', 'community', 'forum'],
      'twitter.com': ['microblog', 'social', 'updates'],
      'linkedin.com': ['professional', 'networking', 'career'],
      'amazon.com': ['ecommerce', 'retail', 'marketplace'],
      'netflix.com': ['streaming', 'movies', 'series'],
      'coursera.org': ['online-learning', 'mooc', 'certification'],
      'arxiv.org': ['preprint', 'research', 'academic']
    };

    for (const [domainPattern, tags] of Object.entries(domainMap)) {
      if (domain.includes(domainPattern.replace('.com', '').replace('.org', ''))) {
        return tags;
      }
    }

    return [];
  }

  extractImageUrl(metadata) {
    if (!metadata) return null;

    // Priority order for image selection
    const imageSources = [
      metadata.ogData?.image,           // OpenGraph image (highest priority)
      metadata.twitterData?.image,      // Twitter Card image
      metadata.ogData?.['image:url'],   // Alternative OpenGraph
      metadata.favicon                 // Favicon as fallback
    ];

    // Return the first valid image URL found
    for (const imageUrl of imageSources) {
      if (imageUrl && typeof imageUrl === 'string' && imageUrl.length > 0) {
        // Ensure it's a valid URL (absolute or relative)
        try {
          // If it's a relative URL, it will be handled by the browser
          if (imageUrl.startsWith('http') || imageUrl.startsWith('//') || imageUrl.startsWith('/')) {
            return imageUrl;
          }
        } catch (e) {
          // Continue to next image source if URL is invalid
        }
      }
    }

    return null;
  }

  detectTechStack(title, metadata) {
    const techKeywords = {
      'javascript': ['javascript', 'js', 'node', 'npm', 'react', 'vue', 'angular'],
      'python': ['python', 'django', 'flask', 'pandas', 'numpy'],
      'java': ['java', 'spring', 'maven', 'gradle'],
      'database': ['sql', 'mysql', 'postgresql', 'mongodb', 'redis'],
      'cloud': ['aws', 'azure', 'gcp', 'docker', 'kubernetes'],
      'ai-ml': ['ai', 'ml', 'machine learning', 'tensorflow', 'pytorch']
    };

    const text = (title + ' ' + (metadata?.description || '')).toLowerCase();
    const tags = [];

    Object.entries(techKeywords).forEach(([category, keywords]) => {
      if (keywords.some(keyword => text.includes(keyword))) {
        tags.push(category);
      }
    });

    return tags;
  }

  extractSemanticTags(text) {
    if (!text) return [];

    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && word.length < 15)
      .filter(word => !this.isStopWord(word))
      .filter(word => !/^\d+$/.test(word)); // Remove pure numbers

    // Use frequency analysis to find important terms
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    return Object.entries(wordCount)
      .filter(([, count]) => count >= 1)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([word]) => word);
  }

  async waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      let tries = 20;
      const checkTabStatus = () => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.warn(`Tab ${tabId} no longer exists`);
            resolve();
            return;
          }

          if (tab.status === 'complete') {
            console.log(`Tab ${tabId} finished loading`);
            resolve();
          } else {
            if(tries === 0) {
              console.log(`Tab ${tabId} ${tab.url} failed to load`);
              resolve();
              return
            }
            console.log(`Tab ${tabId} ${tab.url} still loading (status: ${tab.status}), waiting...`);
            tries = tries - 1;
            setTimeout(checkTabStatus, 500);
          }
        });
      };

      checkTabStatus();
    });
  }

  cleanTag(tag) {
    return tag.toString()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
  }

  isStopWord(word) {
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'how', 'what', 'said', 'each', 'which', 'she', 'how', 'their', 'time', 'will', 'about', 'if', 'up', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'would', 'make', 'like', 'into', 'him', 'has', 'two', 'more', 'go', 'no', 'way', 'could', 'my', 'than', 'first', 'been', 'call', 'who', 'its', 'now', 'find', 'long', 'down', 'day', 'did', 'get', 'come', 'made', 'may', 'part',
      // Additional stop words for better filtering
      'this', 'that', 'with', 'from', 'they', 'we', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'in', 'is', 'it', 'of', 'on', 'to', 'have', 'i', 'that', 'for', 'not', 'with', 'be', 'as', 'you', 'do', 'at',
      // Common web/tech stop words
      'com', 'www', 'http', 'https', 'html', 'page', 'site', 'web', 'home', 'index', 'main', 'new', 'old', 'best', 'good', 'great', 'top', 'free', 'online', 'full', 'latest', 'review', 'guide'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  async tagMultipleUrls(tabs) {
    const taggedTabs = [];

    for (const tab of tabs) {
      try {
        const tagInfo = await this.tagUrl(tab.url, tab.title, tab.id);
        taggedTabs.push({
          ...tab,
          contentTags: tagInfo
        });
      } catch (error) {
        console.error(`Error tagging tab ${tab.url}:`, error);
        taggedTabs.push({
          ...tab,
          contentTags: {
            url: tab.url,
            title: tab.title,
            categories: ['general'],
            confidence: 0,
            domain: new URL(tab.url).hostname,
            tags: ['general'],
            description: null,
            image: null,
            author: null,
            publishedDate: null,
            wordCount: null,
            language: null
          }
        });
      }
    }

    return taggedTabs;
  }
}

// Create global instance
const contentTagger = new ContentTagger();