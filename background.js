/*
Media Downloader Unleashed!! - Rebuilt for Chrome MV3
Based on original code Copyright © 2026 helloyanis
*/

// Polyfill browser to chrome
if (typeof browser === 'undefined') {
    var browser = chrome;
}

// Allow access to storage.session from popup and offscreen pages in Chrome MV3
if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(err => {
        console.warn('Could not set session storage access level:', err);
    });
}

// Ensure offscreen document exists for downloads and DOM operations (DASH MPD DOMParser, ZIP, etc.)
async function ensureOffscreen() {
    try {
        if (await chrome.offscreen?.hasDocument?.()) {
            return;
        }
    } catch (e) {}

    try {
        if (chrome.offscreen) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['DOM_PARSER', 'BLOBS'],
                justification: 'Media downloading, stream parsing and client-side packaging'
            });
            console.log('Offscreen document created successfully.');
        }
    } catch (err) {
        if (!err.message?.includes('Only a single offscreen')) {
            console.warn('Offscreen document creation notice:', err);
        }
    }
}

let urlList = [];
let headersSentListener, headersReceivedListener;

// ---------- IndexedDB helpers ----------
const DB_NAME = "MediaCacheDB";
const STORE_NAME = "network-cache";

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = (event) => reject(event.target.error || "IDB Open Error");
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

async function storeInCache(url, blob, headers, status) {
    try {
        const db = await openCacheDB();

        // Read existing item
        const cachedItem = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        const item = {
            url,
            headers: headers || cachedItem?.headers || {},
            status: status || cachedItem?.status || "000",
            data: blob || cachedItem?.data,
            timestamp: cachedItem?.timestamp || Date.now()
        };

        if (cachedItem) {
            item.mime = cachedItem.mime;
        }

        // Create write transaction
        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(item);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("Failed to store in cache:", e);
    }
}

async function addHeadersToCache(url, headers, status) {
    try {
        const db = await openCacheDB();

        const cachedItem = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!cachedItem) {
            console.debug("Attempted to add headers to an item not in cache. Adding it!");
            await storeInCache(url, null, headers, status);
            return;
        }

        const newItem = {
            url: cachedItem.url,
            headers,
            status,
            data: cachedItem.data,
            mime: cachedItem.mime,
            timestamp: cachedItem.timestamp
        };

        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(newItem);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to add mime to cache:", e);
    }
}

async function removeFromCache(url) {
    try {
        const db = await openCacheDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(url);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("Failed to remove from cache:", e);
    }
}

// ----- Extension lists for url-detection -----
const videoExtensions = [".3g2", ".3gp", ".asx", ".avi", ".divx", ".4v", ".flv", ".ismv", ".m2t", ".m2ts", ".m2v", ".m4s", ".m4v", ".mk3d", ".mkv", ".mng", ".mov", ".mp2v", ".mp4", ".mp4v", ".mpe", ".mpeg", ".mpeg1", ".mpeg2", ".mpeg4", ".mpg", ".mxf", ".ogm", ".ogv", ".qt", ".rm", ".swf", ".ts", ".vob", ".vp9", ".webm", ".wmv"];
const audioExtensions = [".3ga", ".aac", ".ac3", ".adts", ".aif", ".aiff", ".alac", ".ape", ".asf", ".au", ".dts", ".f4a", ".f4b", ".flac", ".isma", ".it", ".m4a", ".m4b", ".m4r", ".mid", ".mka", ".mod", ".mp1", ".mp2", ".mp3", ".mp4a", ".mpa", ".mpga", ".oga", ".ogg", ".ogx", ".opus", ".ra", ".shn", ".spx", ".vorbis", ".wav", ".weba", ".wma", ".xm"];
const streamExtensions = [".f4f", ".f4m", ".m3u8", ".mpd", ".smil"];
const subtitleExtensions = [".srt", ".vtt", ".sub", ".ass", ".ssa", ".idx", ".ttml", ".dfxp"];

const allExtensions = videoExtensions.concat(audioExtensions, streamExtensions, subtitleExtensions);
const extPattern = allExtensions.map(e => e.replace(/^\./, '').replace(/\+/g, '\\+')).join('|');
const detectionRegex = new RegExp('\\.(?:' + extPattern + ')(?:[?#].*)?$', 'i');
const temporaryHeaderMap = new Map();
const temporaryRequestBodyMap = new Map();
const temporaryCookieMap = new Map();

function getDirKeyFromUrl(urlString) {
    try {
        const u = new URL(urlString);
        return u.origin + u.pathname.substring(0, u.pathname.lastIndexOf('/') + 1);
    } catch (e) {
        return urlString.split('?')[0];
    }
}

function recordParamDiff(urlString) {
    try {
        const u = new URL(urlString);
        const dirKey = getDirKeyFromUrl(urlString);
        const keys = Array.from(u.searchParams.keys());

        browser.storage.session.get('segmentParamOverrides', function (res) {
            const map = res?.segmentParamOverrides || {};
            const existing = map[dirKey] || { observedParams: [], extraParams: {}, lastSeen: Date.now(), example: '' };
            const existingSet = new Set(existing.observedParams || []);

            const newExtra = {};
            let added = false;
            for (const k of keys) {
                if (!existingSet.has(k)) {
                    newExtra[k] = u.searchParams.get(k);
                    added = true;
                }
            }

            if (added) {
                existing.observedParams = Array.from(new Set((existing.observedParams || []).concat(keys)));
                existing.extraParams = Object.assign(existing.extraParams || {}, newExtra);
                existing.lastSeen = Date.now();
                existing.example = existing.example || urlString;
                map[dirKey] = existing;
                browser.storage.session.set({ segmentParamOverrides: map }, function () {
                    console.log('Detected extra query params for', dirKey, 'added', newExtra);
                });
            } else if (!existing.observedParams || existing.observedParams.length === 0) {
                existing.observedParams = keys;
                existing.lastSeen = Date.now();
                existing.example = existing.example || urlString;
                map[dirKey] = existing;
                browser.storage.session.set({ segmentParamOverrides: map });
            }
        });
    } catch (e) {
        console.error('recordParamDiff error', e);
    }
}

function isFlagEnabled(val) {
    return val === '1' || val === 1 || val === true || val === 'true';
}

function getSettings(callback) {
    browser.storage.local.get(['mime-detection', 'url-detection', 'media-cache', 'media-cache-private'], function (result) {
        const mimeRaw = result && Object.prototype.hasOwnProperty.call(result, 'mime-detection') ? result['mime-detection'] : '1';
        const urlRaw = result && Object.prototype.hasOwnProperty.call(result, 'url-detection') ? result['url-detection'] : '1';
        const mediaCache = result && Object.prototype.hasOwnProperty.call(result, 'media-cache') ? result['media-cache'] : '1';
        const mediaCachePrivate = result && Object.prototype.hasOwnProperty.call(result, 'media-cache-private') ? result['media-cache-private'] : '0';
        callback({
            mimeDetection: isFlagEnabled(mimeRaw),
            urlDetection: isFlagEnabled(urlRaw),
            mediaCache: isFlagEnabled(mediaCache),
            mediaCachePrivate: isFlagEnabled(mediaCachePrivate)
        });
    });
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

let beforeRequestListener, beforeSendHeadersListener;

function isExtensionOrigin(details) {
    const origin = details.originUrl || details.initiator || '';
    return origin.startsWith('moz-extension:') || origin.startsWith('chrome-extension:');
}

function initListener() {
    openCacheDB().then(db => {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
    }).catch(e => {
        console.error("Failed to clear IndexedDB cache on init:", e);
    });

    urlList = ["<all_urls>"];

    getSettings(function (settings) {
        const mimeEnabled = !!settings.mimeDetection;
        const urlEnabled = !!settings.urlDetection;
        const mediaCacheEnabled = !!settings.mediaCache;
        const mediaCachePrivateEnabled = !!settings.mediaCachePrivate;

        console.log('initListener settings: mimeEnabled=', mimeEnabled, 'urlEnabled=', urlEnabled);

        if (headersSentListener) {
            try { browser.webRequest.onSendHeaders.removeListener(headersSentListener); } catch (e) { }
        }
        if (beforeSendHeadersListener) {
            try { browser.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeadersListener); } catch (e) { }
        }
        if (headersReceivedListener) {
            try { browser.webRequest.onHeadersReceived.removeListener(headersReceivedListener); } catch (e) { }
        }
        if (beforeRequestListener) {
            try { browser.webRequest.onBeforeRequest.removeListener(beforeRequestListener); } catch (e) { }
            beforeRequestListener = null;
        }

        beforeRequestListener = function (details) {
            try {
                if (!details || !details.requestBody || isExtensionOrigin(details)) return;

                const rb = details.requestBody;
                if (rb.formData) {
                    temporaryRequestBodyMap.set(details.requestId, { type: 'formData', data: rb.formData });
                } else if (rb.raw && rb.raw.length) {
                    try {
                        let totalLen = 0;
                        for (let part of rb.raw) {
                            if (part && part.bytes) {
                                totalLen += part.bytes.byteLength || part.bytes.length || 0;
                            }
                        }
                        if (totalLen === 0) return;
                        const combined = new Uint8Array(totalLen);
                        let offset = 0;
                        for (let part of rb.raw) {
                            if (!part || !part.bytes) continue;
                            const src = new Uint8Array(part.bytes);
                            combined.set(src, offset);
                            offset += src.length;
                        }
                        const base64 = arrayBufferToBase64(combined.buffer);
                        temporaryRequestBodyMap.set(details.requestId, { type: 'base64', data: base64 });
                    } catch (e) {
                        console.warn("Failed to serialize raw request body for requestId", details.requestId, e);
                    }
                }
            } catch (e) {
                console.error("Error in onBeforeRequest listener (requestBody capture):", e);
            }
        };

        try {
            if (browser.webRequest && browser.webRequest.onBeforeRequest && !browser.webRequest.onBeforeRequest.hasListener(beforeRequestListener)) {
                browser.webRequest.onBeforeRequest.addListener(
                    beforeRequestListener,
                    { urls: urlList },
                    ['requestBody']
                );
            }
        } catch (e) {
            console.warn("Failed to attach onBeforeRequest requestBody listener:", e);
        }

        beforeSendHeadersListener = function (details) {
            if (isExtensionOrigin(details)) return;

            const cookie = details.requestHeaders?.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
            if (cookie) {
                temporaryCookieMap.set(details.url, cookie);
            }
        };

        // Attach onBeforeSendHeaders with extraHeaders for full cookie and header inspection in Chrome
        try {
            const extraOptions = ['requestHeaders'];
            if (chrome.webRequest.OnBeforeSendHeadersOptions && 'EXTRA_HEADERS' in chrome.webRequest.OnBeforeSendHeadersOptions) {
                extraOptions.push('extraHeaders');
            }
            browser.webRequest.onBeforeSendHeaders.addListener(
                beforeSendHeadersListener,
                { urls: urlList },
                extraOptions
            );
            console.log("Attached onBeforeSendHeaders listener.");
        } catch (e) {
            // Fallback without extraHeaders if unsupported
            browser.webRequest.onBeforeSendHeaders.addListener(
                beforeSendHeadersListener,
                { urls: urlList },
                ['requestHeaders']
            );
        }

        headersSentListener = async function (details) {
            if (isExtensionOrigin(details)) return;

            try {
                if (details.requestHeaders) {
                    temporaryHeaderMap.set(details.requestId, details.requestHeaders);
                }

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                if (!mimeEnabled && !urlEnabled) {
                    // Save all
                } else {
                    if (!urlEnabled || (urlEnabled && !urlMatches)) {
                        if (urlEnabled && mimeEnabled && !urlMatches) return;
                        if (mimeEnabled && !urlEnabled) return;
                    }
                }

                const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;

                let tabTitle = null;
                if (browser.tabs && details.tabId !== undefined && details.tabId !== -1) {
                    try {
                        const tab = await browser.tabs.get(details.tabId);
                        tabTitle = tab?.title || null;
                    } catch (e) { }
                }

                let mediaRequest = {
                    requestId: details.requestId,
                    url: details.url,
                    name: tabTitle,
                    method: details.method,
                    requestHeaders: details.requestHeaders,
                    responseHeaders: null,
                    requestBody: cachedBody,
                    cookie: temporaryCookieMap.get(details.url) || '',
                    size: null,
                    timeStamp: null,
                    tabId: details.tabId
                };

                browser.storage.session.get(details.url, function (result) {
                    let existingRequests = (result && result[details.url]) || [];

                    if (existingRequests.length > 1000) {
                        const oldestRequest = existingRequests.shift();
                        temporaryRequestBodyMap.delete(oldestRequest.requestId);
                        temporaryHeaderMap.delete(oldestRequest.requestId);
                        temporaryCookieMap.delete(oldestRequest.requestId);
                        removeFromCache(oldestRequest.url).catch(e => {
                            console.error("Failed to remove from cache for oldest request:", oldestRequest.url, e);
                        });
                    }

                    existingRequests.push(mediaRequest);
                    let requestsObj = {};
                    requestsObj[details.url] = existingRequests;
                    browser.storage.session.set(requestsObj);
                    console.log('Media request intercepted (onSendHeaders):', mediaRequest);
                    try { recordParamDiff(details.url); } catch (e) { }
                });
            } catch (e) {
                console.error("Error in onSendHeaders handler:", e);
            }
        };

        try {
            const sendHeadersOptions = ['requestHeaders'];
            if (chrome.webRequest.OnSendHeadersOptions && 'EXTRA_HEADERS' in chrome.webRequest.OnSendHeadersOptions) {
                sendHeadersOptions.push('extraHeaders');
            }
            browser.webRequest.onSendHeaders.addListener(
                headersSentListener,
                { urls: urlList },
                sendHeadersOptions
            );
        } catch (e) {
            browser.webRequest.onSendHeaders.addListener(
                headersSentListener,
                { urls: urlList },
                ['requestHeaders']
            );
        }

        headersReceivedListener = async function (details) {
            if (isExtensionOrigin(details)) return;

            try {
                const responseHeaders = details.responseHeaders || [];
                let mediaSizeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-length');
                let size = mediaSizeHeader ? mediaSizeHeader.value : 'unknown';

                let contentTypeHeader = responseHeaders.find(header => header.name && header.name.toLowerCase() === 'content-type');
                let contentType = contentTypeHeader ? (contentTypeHeader.value || '').toLowerCase() : '';

                if (contentType.indexOf(';') !== -1) {
                    contentType = contentType.split(';')[0].trim().toLowerCase();
                }

                if (contentType === 'application/vnd.yt-ump') {
                    console.debug("Detected YouTube video, adding placeholder entry for", details.url);
                    await browser.storage.session.set({ [details.url]: [{ contentType: contentType }] });
                    return;
                }

                const mimeMatches = (
                    contentType.startsWith('audio/') ||
                    contentType.startsWith('video/') ||
                    contentType.includes('application/vnd.apple.mpegurl') ||
                    contentType.includes('application/x-mpegurl') ||
                    contentType.includes('application/dash+xml') ||
                    contentType.includes('application/x-matroska') ||
                    contentType.includes('application/octet-stream') ||
                    contentType.includes('text/vtt') ||
                    contentType.includes('application/ttml+xml') ||
                    contentType.includes('application/x-subrip') ||
                    contentType.includes('application/x-srt')
                );

                const urlMatches = detectionRegex.test(decodeURI(details.url));

                browser.storage.session.get(details.url, async function (result) {
                    let existingRequests = (result && result[details.url]) || [];
                    const userSettings = await new Promise((resolve) => getSettings(resolve));

                    if (userSettings.mimeDetection && !mimeMatches) {
                        browser.storage.session.remove(details.requestId);
                        removeFromCache(details.url).catch(() => {});
                        return;
                    }

                    let updated = false;
                    for (let request of existingRequests) {
                        if (!request.size && (!request.responseHeaders || request.responseHeaders === null)) {
                            request.size = size;
                            request.responseHeaders = responseHeaders;
                            request.timeStamp = details.timeStamp;
                            updated = true;
                            break;
                        }
                    }

                    if (contentTypeHeader && ((mediaCacheEnabled && !details.incognito) || (mediaCachePrivateEnabled && details.incognito))) {
                        addHeadersToCache(details.url, responseHeaders, details.statusCode);
                    }

                    getSettings(async function (currentSettings) {
                        const mimeEnabledNow = !!currentSettings.mimeDetection;
                        const urlEnabledNow = !!currentSettings.urlDetection;

                        const shouldSaveNow = (() => {
                            if (!mimeEnabledNow && !urlEnabledNow) return true;
                            if (mimeEnabledNow && mimeMatches) return true;
                            if (urlEnabledNow && urlMatches) return true;
                            return false;
                        })();

                        if (!updated && shouldSaveNow) {
                            const cachedHeaders = temporaryHeaderMap.get(details.requestId) || null;
                            const cachedBody = temporaryRequestBodyMap.get(details.requestId) || null;

                            let tabTitle = null;
                            if (browser.tabs && details.tabId !== undefined && details.tabId !== -1) {
                                try {
                                    const tab = await browser.tabs.get(details.tabId);
                                    tabTitle = tab?.title || null;
                                } catch (e) { }
                            }

                            let mediaRequest = {
                                requestId: details.requestId,
                                url: details.url,
                                name: tabTitle,
                                method: details.method || 'GET',
                                requestHeaders: cachedHeaders,
                                responseHeaders: responseHeaders,
                                requestBody: cachedBody,
                                cookie: temporaryCookieMap.get(details.url) || '',
                                size: size,
                                timeStamp: details.timeStamp,
                                tabId: details.tabId
                            };
                            existingRequests.push(mediaRequest);
                            console.log('Media request added (onHeadersReceived):', mediaRequest);
                            try { recordParamDiff(details.url); } catch (e) { }
                        } else if (updated) {
                            console.log('Media response updated (onHeadersReceived) for', details.url);
                        }

                        let requestsObj = {};
                        requestsObj[details.url] = existingRequests;
                        browser.storage.session.set(requestsObj);
                    });
                });
            } catch (e) {
                console.error("Error in onHeadersReceived handler:", e);
            }
        };

        try {
            const responseOptions = ['responseHeaders'];
            if (chrome.webRequest.OnHeadersReceivedOptions && 'EXTRA_HEADERS' in chrome.webRequest.OnHeadersReceivedOptions) {
                responseOptions.push('extraHeaders');
            }
            browser.webRequest.onHeadersReceived.addListener(
                headersReceivedListener,
                { urls: urlList },
                responseOptions
            );
        } catch (e) {
            browser.webRequest.onHeadersReceived.addListener(
                headersReceivedListener,
                { urls: urlList },
                ['responseHeaders']
            );
        }
    });
}

// Send media request data to the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure offscreen document is ready when downloads are triggered
    if (['downloadRawMedia', 'downloadM3U8Offline', 'downloadMPDOffline', 'cancelDownload', 'getOngoingDownloads'].includes(message.action)) {
        ensureOffscreen();
    }

    if (message.action === 'getMediaRequests') {
        browser.storage.session.get(null, function (items) {
            items = items || {};
            delete items['completedDownloads'];
            delete items['failedDownloads'];
            delete items['queuedAndroidDownloads'];
            delete items['pendingPopupState'];

            if (message.tabId !== undefined && !isNaN(message.tabId)) {
                const tabId = parseInt(message.tabId, 10);
                const tabMediaUrls = Object.keys(items).filter(url => Array.isArray(items[url]) && items[url].some(r => r.tabId === tabId));
                const otherMediaUrls = Object.keys(items).filter(url => !tabMediaUrls.includes(url));
                const sortedUrls = [...tabMediaUrls, ...otherMediaUrls];
                const sortedItems = {};
                for (const url of sortedUrls) {
                    sortedItems[url] = items[url];
                }
                sendResponse(sortedItems);
            } else {
                sendResponse(items);
            }
        });
        return true;
    }

    if (message.action === 'clearStorage') {
        const ongoingDownloads = message.ongoingDownloads || [];
        const ongoingIDs = new Set(ongoingDownloads.map(d => d.requestId));
        const ongoingURLs = new Set(ongoingDownloads.map(d => d.url));

        browser.storage.session.get(null, function (items) {
            items = items || {};
            for (let url in items) {
                let requests = items[url];
                if (!Array.isArray(requests)) {
                    requests = [requests];
                }
                const filteredRequests = requests.filter(r => ongoingIDs.has(r.requestId));
                if (filteredRequests.length > 0) {
                    let obj = {};
                    obj[url] = filteredRequests;
                    browser.storage.session.set(obj);
                } else {
                    browser.storage.session.remove(url);
                }
            }
        });

        openCacheDB().then(db => {
            const tx = db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.openCursor();
            request.onsuccess = function (event) {
                const cursor = event.target.result;
                if (cursor) {
                    if (!ongoingURLs.has(cursor.value.url)) {
                        store.delete(cursor.primaryKey);
                    }
                    cursor.continue();
                }
            };
        }).catch(e => {
            console.error("Failed to clear IndexedDB cache:", e);
        });
        sendResponse({ success: true });
        return true;
    }
});

// Initialize listener and offscreen document
initListener();
ensureOffscreen();

browser.runtime.onInstalled.addListener((details) => {
    initListener();
    ensureOffscreen();
});

browser.runtime.onStartup.addListener(() => {
    initListener();
    ensureOffscreen();
});
