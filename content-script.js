// content-script.js - Extract metadata from web pages for better content classification

class MetaExtractor {
  constructor() {
    this.metaData = null;
  }

  extractPageMetadata() {
    try {
      const metadata = {
        url: window.location.href,
        title: document.title,
        description: this.getMetaDescription(),
        keywords: this.getMetaKeywords(),
        ogData: this.getOpenGraphData(),
        twitterData: this.getTwitterCardData(),
        schemaData: this.getSchemaOrgData(),
        headings: this.getHeadings(),
        lang: this.getLanguage(),
        author: this.getAuthor(),
        publishedDate: this.getPublishedDate(),
        articleData: this.getArticleData(),
        favicon: this.getFavicon(),
        timestamp: new Date().toISOString()
      };

      this.metaData = metadata;
      return metadata;
    } catch (error) {
      console.error('Error extracting metadata:', error);
      return {
        url: window.location.href,
        title: document.title,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  getMetaDescription() {
    const descriptions = [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[itemprop="description"]'
    ];

    for (const selector of descriptions) {
      const meta = document.querySelector(selector);
      if (meta && meta.content) {
        return meta.content.trim();
      }
    }
    return null;
  }

  getMetaKeywords() {
    const keywords = document.querySelector('meta[name="keywords"]');
    return keywords ? keywords.content.split(',').map(k => k.trim()) : [];
  }

  getOpenGraphData() {
    const ogData = {};
    const ogMetas = document.querySelectorAll('meta[property^="og:"]');
    
    ogMetas.forEach(meta => {
      const property = meta.getAttribute('property').replace('og:', '');
      ogData[property] = meta.content;
    });

    return ogData;
  }

  getTwitterCardData() {
    const twitterData = {};
    const twitterMetas = document.querySelectorAll('meta[name^="twitter:"]');
    
    twitterMetas.forEach(meta => {
      const name = meta.getAttribute('name').replace('twitter:', '');
      twitterData[name] = meta.content;
    });

    return twitterData;
  }

  getSchemaOrgData() {
    const schemas = [];
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    
    jsonLdScripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        schemas.push(data);
      } catch (e) {
        // Ignore malformed JSON-LD
      }
    });

    return schemas;
  }

  getHeadings() {
    const headings = {};
    ['h1', 'h2', 'h3'].forEach(tag => {
      const elements = document.querySelectorAll(tag);
      headings[tag] = Array.from(elements)
        .map(el => el.textContent.trim())
        .filter(text => text.length > 0)
        .slice(0, 5); // Limit to first 5 headings per level
    });
    return headings;
  }

  getLanguage() {
    return document.documentElement.lang || 
           document.querySelector('meta[http-equiv="content-language"]')?.content ||
           null;
  }

  getAuthor() {
    const authorSelectors = [
      'meta[name="author"]',
      'meta[property="og:article:author"]',
      'meta[name="twitter:creator"]',
      'meta[itemprop="author"]',
      '[rel="author"]'
    ];

    for (const selector of authorSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.content || element.textContent || element.href;
      }
    }
    return null;
  }

  getPublishedDate() {
    const dateSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]',
      'time[datetime]',
      'time[pubdate]'
    ];

    for (const selector of dateSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.content || element.getAttribute('datetime') || element.textContent;
      }
    }
    return null;
  }

  getArticleData() {
    // Look for article-specific content
    const article = document.querySelector('article, [role="main"], .post, .entry');
    if (!article) return null;

    const text = article.textContent || '';
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    
    return {
      wordCount: wordCount,
      hasArticleTag: !!document.querySelector('article'),
      estimatedReadingTime: Math.ceil(wordCount / 200) // ~200 words per minute
    };
  }

  getFavicon() {
    // Try to find favicon with priority order
    const faviconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]', 
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]'
    ];
    
    for (const selector of faviconSelectors) {
      const link = document.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }
    
    // Fallback to default favicon location
    try {
      const defaultFavicon = new URL('/favicon.ico', window.location.origin).href;
      return defaultFavicon;
    } catch (e) {
      return null;
    }
  }

  // Enhanced categorization based on metadata
  categorizeFromMetadata() {
    if (!this.metaData) return [];

    const categories = new Set();
    const { description, keywords, ogData, schemaData, headings } = this.metaData;
    
    // Combine all text content for analysis
    const allText = [
      this.metaData.title,
      description,
      ...(keywords || []),
      ogData?.type,
      ogData?.site_name,
      ...Object.values(headings || {}).flat()
    ].filter(Boolean).join(' ').toLowerCase();

    // Enhanced categorization patterns
    const categoryPatterns = {
      'news': ['news', 'article', 'breaking', 'report', 'journalism', 'press', 'media'],
      'technology': ['tech', 'software', 'programming', 'code', 'developer', 'api', 'framework'],
      'business': ['business', 'finance', 'startup', 'entrepreneur', 'market', 'company'],
      'entertainment': ['entertainment', 'movie', 'music', 'game', 'video', 'stream', 'show'],
      'education': ['education', 'learn', 'course', 'tutorial', 'university', 'study', 'training'],
      'health': ['health', 'medical', 'wellness', 'fitness', 'nutrition', 'doctor'],
      'sports': ['sport', 'football', 'basketball', 'soccer', 'athlete', 'game', 'match'],
      'science': ['science', 'research', 'study', 'discovery', 'experiment', 'academic'],
      'lifestyle': ['lifestyle', 'fashion', 'travel', 'food', 'recipe', 'design', 'home'],
      'shopping': ['shop', 'buy', 'product', 'store', 'retail', 'price', 'deal', 'cart']
    };

    // Check Schema.org structured data
    if (schemaData && schemaData.length > 0) {
      schemaData.forEach(schema => {
        const type = schema['@type'] || schema.type;
        if (type) {
          if (type.includes('Article') || type.includes('NewsArticle')) categories.add('news');
          if (type.includes('Product')) categories.add('shopping');
          if (type.includes('Recipe')) categories.add('lifestyle');
          if (type.includes('Course')) categories.add('education');
        }
      });
    }

    // Pattern matching on combined text
    Object.entries(categoryPatterns).forEach(([category, patterns]) => {
      if (patterns.some(pattern => allText.includes(pattern))) {
        categories.add(category);
      }
    });

    // OpenGraph type detection
    if (ogData?.type) {
      const ogType = ogData.type.toLowerCase();
      if (ogType.includes('article')) categories.add('news');
      if (ogType.includes('video')) categories.add('entertainment');
      if (ogType.includes('product')) categories.add('shopping');
    }

    return Array.from(categories);
  }
}

// Initialize and set up message listener
const metaExtractor = new MetaExtractor();

// Listen for messages from popup/background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    // Simple ping/pong to check if content script is available
    sendResponse('pong');
    return;
  }
  
  if (request.action === 'getMetadata') {
    try {
      const metadata = metaExtractor.extractPageMetadata();
      const categories = metaExtractor.categorizeFromMetadata();
      
      sendResponse({
        success: true,
        metadata: metadata,
        categories: categories
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }
  return true; // Keep message channel open for async response
});