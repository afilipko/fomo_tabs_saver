# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture


1. **Chrome Extension**: A browser extension for exporting open tabs with AI-powered features
   - Located in `./` directory
   - Exports tabs in JSON format
   - Smart filtering: removes duplicates and auth/login pages
   - IndexedDB storage for persistent tab export history and also allows downloading as a file

## Common Commands

### Chrome Extension Development
The extension files are in `./` and can be loaded directly into Chrome as an unpacked extension for testing.

Key files:
- `popup.html/js`: Main extension interface
- `indexeddb.js`: Local storage management
- `content-tagger.js`: AI-powered URL content classification
- `manifest.json`: Extension configuration with Transformers.js permissions

Features:
- Smart duplicate detection and auth page filtering
- AI content categorization using Transformers.js with meta tag extraction
- Rich metadata extraction: og:description, keywords, author, publish date
- Enhanced categorization from Schema.org, OpenGraph, and Twitter Card data
- Content scripts extract page metadata for improved AI classification
- Local storage with IndexedDB for export history
- Multiple export formats with embedded tags, categories, and metadata
