/** ****************************************************************************
 * Cache.js
 *
 * Copyright (C) 2007 Alexander C. Hubmann
 * Copyright (C) 2007-2008 Alexander C. Hubmann-Haidvogel
 *
 * Implements cache for threaded messages
 *
 * $Id$
 ******************************************************************************/



if (! window.ThreadVisNS) {
    window.ThreadVisNS = {};
}



/** ****************************************************************************
 * Create cache object
 ******************************************************************************/
ThreadVisNS.Cache = function(threadvis) {
    this.threadvis = threadvis;
    this.openDatabases();
    this.accountCaches = {};
    this.callbacks = [];
    this.createAccountCaches();
}



/** ****************************************************************************
 * Get cache array for message
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getCache = function(msg) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getCache", {"action" : "start"});
    }
    var server = msg.folder.server;
    var account = (Components.classes["@mozilla.org/messenger/account-manager;1"]
        .getService(Components.interfaces.nsIMsgAccountManager))
        .FindAccountForServer(server);

    var cache = this.getCacheInternal(msg, account.key, false);

    account = null;
    delete account;
    server = null;
    delete server;

    this.threadvis.getThreader().thread();
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getCache", {"action" : "end", "cache" : cache});
    }
    return cache;
}



/** ****************************************************************************
 * Get cache array for message (internal)
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getCacheInternal = function(msg, accountKey, references) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getCacheInternal", {"action" : "start"});
    }

    var cache = [];
    var connection = this.getDatabaseConnection(accountKey);
    var statement = connection.createStatement(
        "SELECT threadid FROM threads WHERE msgid = ?");
    statement.bindStringParameter(0, msg.messageId);

    var threadId = null;
    try {
        if (statement.executeStep()) {
            threadId = statement.getInt32(0);
        }
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
    }

    if (threadId != null) {
        statement = connection.createStatement(
            "SELECT msgid FROM threads WHERE threadid = ?");
        statement.bindInt32Parameter(0, threadId);
        try {
            while (statement.executeStep()) {
                var msgid = statement.getString(0);
                cache.push(msgid);
            }
        } catch (ex) {
            THREADVIS.logger.log("Error while performing SQL statement", {
                "exception": ex});
        } finally {
            statement.reset;
            statement = null;
        }
    }

    connection = null;
    delete connection;

    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getCacheInternal", {"read cache" : cache});
    }
    if (cache.length > 0) {
        //this.addToThreaderFromCache(cache, msg.folder.rootFolder);
    } else {
        if (references) {
            this.addToThreaderFromReferences(msg, accountKey);
        }
    }

    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getCacheInternal", {"action" : "end"});
    }

    return cache;
}



/** ****************************************************************************
 * Add all messages from references to threader
 ******************************************************************************/
ThreadVisNS.Cache.prototype.addToThreaderFromReferences = function(msg, accountKey) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "addToThreaderFromReferences", {"action" : "start"});
    }

    var rootFolder = msg.folder.rootFolder;
    this.threadvis.addMessage(msg);
    var references = (new ThreadVisNS.References(msg.getStringProperty("references")))
        .getReferences();

    for (var i = 0; i < references.length; i++) {
        var ref = references[i];
        // fixxme rootfolder
        if (this.threadvis.getThreader().hasMessage(ref)) {
            continue;
        }
        var refMessage = this.searchMessageByMsgId(ref, rootFolder);
        if (refMessage) {
            this.getCacheInternal(refMessage, accountKey, true);
        }
    }

    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "addToThreaderFromReferences", {"action" : "end"});
    }
}



/** ****************************************************************************
 * Add all messages from cache to threader
 ******************************************************************************/
ThreadVisNS.Cache.prototype.addToThreaderFromCache = function(cache, rootFolder) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "addToThreaderFromCache", {"action" : "start"});
    }

    for (var i = 0; i < cache.length; i++) {
        var msgId = cache[i];
        if (this.threadvis.getThreader().hasMessage(msgId)) {
            continue;
        }
        var msg = this.searchMessageByMsgId(msgId, rootFolder);
        if (msg != null) {
            this.threadvis.addMessage(msg);
        } else {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_ERROR,
                    "addToThreaderFromCache", {"action" : "searchMessageByMsgId",
                    "message" : "message not found",
                    "msgid" : msgId,
                    "rootFolder" : rootFolder.URI});
            }
        }
    }

    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "addToThreaderFromCache", {"action" : "end"});
    }
}



/** ****************************************************************************
 * Search for message id in current account
 ******************************************************************************/
ThreadVisNS.Cache.prototype.searchMessageByMsgId = function(messageId, rootFolder) {
    return this.searchInFolder(rootFolder, messageId);
}



/** ****************************************************************************
 * Search for message id in folder
 ******************************************************************************/
ThreadVisNS.Cache.prototype.searchInFolder = function(folder, messageId) {
    // first, search in this folder
    // check for enabled/disabled folders
    if (THREADVIS.checkEnabledAccountOrFolder(folder)) {
        // exclude virtual folders in search
        if (! (folder.flags & MSG_FOLDER_FLAG_VIRTUAL) &&
            !folder.noSelect) {
            // again, do not call updateFolder, this is bad
            //subfolder.updateFolder(null);
            try {
                msgDB = folder.getMsgDatabase(null);
            } catch (ex) {
                // can we do this here?
                try {
                    folder.updateFolder(null);
                    msgDB = folder.getMsgDatabase(null);
                } catch (ex) {
                }
            }

            if (msgDB) {
                msgHdr = msgDB.getMsgHdrForMessageID(messageId);
                msgDB = null;
                delete msgDB;
            }

            if (msgHdr) {
                return msgHdr;
            }
        }
    }

    // if not found, loop over subfolders and search them
    if (folder.hasSubFolders) {
        // Seamonkey < 2 and Thunderbird <= 2 use GetSubFolders
        // (which returns a nsIEnumerator)
        // so we have to use .currentItem() and .next()
        // Thunderbird 3 and Seamonkey 2 use subFolders (which returns a nsISimpleEnumerator
        // so we have to use .getNext() and .hasMoreElements()
        var subfolders = null;
        if (folder.GetSubFolders) {
            subfolders = folder.GetSubFolders();
        }
        if (folder.subFolders) {
            subfolders = folder.subFolders;
        }
        var subfolder = null;
        var msgHdr = null;
        var msgDB = null;
        var currentFolderURI = "";

        var done = false;
        while(!done) {
            var currentItem = null;
            if (subfolders.currentItem) {
                currentItem = subfolders.currentItem();
            }
            if (subfolders.getNext) {
                currentItem = subfolders.getNext();
            }
            currentFolderURI = currentItem
                .QueryInterface(Components.interfaces.nsIRDFResource).Value;
            subfolder = GetMsgFolderFromUri(currentFolderURI);

            var foundHeader = this.searchInFolder(subfolder, messageId);
            subfolder = null;
            delete subfolder;
            if (foundHeader) {
                return foundHeader;
            }

            try {
                if (subfolders.next) {
                    subfolders.next();
                }
                if (subfolders.hasMoreElements) {
                    done = ! subfolders.hasMoreElements();
                }
            } catch(e) {
                done = true;
            }
        }
    }
    return null;
}



/** ****************************************************************************
 * Reset all caches for all messages in account
 ******************************************************************************/
ThreadVisNS.Cache.prototype.reset = function(accountKey) {
    // reset the cache for the account, i.e. delete the cache file and
    // re-create it
    // this also resets any update timestamps, as they are stored in the
    // database aswell
    this.openDatabase(accountKey, true);
}



/** ****************************************************************************
 * Get the connection for a specific account
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getDatabaseConnection = function(account) {
    return this.databaseConnections[account];
}



/** ****************************************************************************
 * Open/create thread databases for all accounts
 ******************************************************************************/
ThreadVisNS.Cache.prototype.openDatabases = function() {
    this.databaseConnections = new Object();
    var accountManager = Components.classes["@mozilla.org/messenger/account-manager;1"]
        .getService(Components.interfaces.nsIMsgAccountManager);

    var accounts = accountManager.accounts;
    for (var i = 0; i < accounts.Count(); i++)  {
        var account = accounts.QueryElementAt(i, Components.interfaces.nsIMsgAccount);
        this.openDatabase(account.key);
        delete account;
        account = null;
    }
}



/** ****************************************************************************
 * Open/create thread database
 ******************************************************************************/
ThreadVisNS.Cache.prototype.openDatabase = function(accountKey, forceRecreate) {
    var storageService = Components.classes["@mozilla.org/storage/service;1"]
        .getService(Components.interfaces.mozIStorageService);

    // try to create file
    var file = Components.classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("ProfD", Components.interfaces.nsIFile);

    file.append("ThreadVis");
    if (! file.exists()) {
        file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
    }

    file.append("cache");
    if (! file.exists()) {
        file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
    }

    // use one file per account to allow for selective cache clear
    // and to avoid corruption
    file.append(accountKey + ".cache.sqlite");

    var connection = storageService.openDatabase(file);

    // drop tables if forceRecreate
    if (forceRecreate) {
        if (connection.tableExists("threads")) {
            connection.executeSimpleSQL("DROP TABLE threads");
        }
        if (connection.tableExists("threadcounter")) {
            connection.executeSimpleSQL("DROP TABLE threadcounter");
        }
        if (connection.tableExists("updatetimestamps")) {
            connection.executeSimpleSQL("DROP TABLE updatetimestamps");
        }
    }

    // check for table
    if (! connection.tableExists("threads")) {
        connection.createTable("threads", "msgid string, threadid int");
        connection.executeSimpleSQL("CREATE UNIQUE INDEX msgid_idx ON threads(msgid ASC)");
        connection.executeSimpleSQL("CREATE INDEX threadid_idx ON threads(threadid ASC)");
    }
    if (! connection.tableExists("threadcounter")) {
        connection.createTable("threadcounter", "threadid int");
    }
    if (! connection.tableExists("updatetimestamps")) {
        connection.createTable("updatetimestamps", "folderuri string, updatetimestamp string");
    }

    this.databaseConnections[accountKey] = connection;
}



/** ****************************************************************************
 * Start a database transaction
 ******************************************************************************/
ThreadVisNS.Cache.prototype.beginDatabaseTransaction = function(accountKey) {
    try {
        this.getDatabaseConnection(accountKey).beginTransaction();
    } catch (ex) {
    }
}



/** ****************************************************************************
 * End a database transaction
 ******************************************************************************/
ThreadVisNS.Cache.prototype.commitDatabaseTransaction = function(accountKey) {
    try {
        this.getDatabaseConnection(accountKey).commitTransaction();
    } catch (ex) {
    }
}



/** ****************************************************************************
 * Clear in-memory data
 ******************************************************************************/
ThreadVisNS.Cache.prototype.clearData = function() {
    this.threadvis.getThreader().reset();
}



/** ****************************************************************************
 * Check if message is already cached
 *
 * @param msgId
 *          The message id to be checked.
 * @param accountKey
 *          The accountKey of the account in which the message is stored.
 * @return
 *          True if message exists in database, false if not.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.isCached = function(msgId, accountKey) {
    var connection = this.getDatabaseConnection(accountKey);
    var statement = connection.createStatement(
        "SELECT threadid FROM threads WHERE msgid = ?");
    statement.bindStringParameter(0, msgId);

    var threadId = null;
    try {
        if (statement.executeStep()) {
            threadId = statement.getInt32(0);
        }
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    }
    statement.reset();
    statement = null;
    delete statement;
    connection = null;
    delete connection;

    var isCached = threadId != null;

    return isCached;
}



/** ****************************************************************************
 * Check if any of the passed message ids exists in the database
 * if so, return the thread key
 * @param accountKey
 *          The account key to create the database connection.
 * @param messageIds
 *          The array of all message ids in the thread.
 * @return
 *          An array of all thread ids, if they exists. Emtpty array otherwise.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getThreadIdsForMessageIds = function(accountKey,
    messageIds) {

    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getThreadIdsForMessageIds", {"action" : "start"});
    }

    var connection = this.getDatabaseConnection(accountKey);
    var statement = connection.createStatement(
        "SELECT threadid FROM threads WHERE msgid = ?");

    var count = 0;
    var threadIds = [];
    try {
        for (var i = 0; i < messageIds.length; i++) {
            count++;
            statement.bindStringParameter(0, messageIds[i]);
            if (statement.executeStep()) {
                var threadId = statement.getInt32(0);
                if (threadId) {
                    threadIds.push(threadId);
                }
            }
            statement.reset();
        }
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
        connection = null;
        delete connection;
    }

    return threadIds;
}



/** ****************************************************************************
 * Create a new thread id
 * @param accountKey
 *          The account key to create the database connection.
 * @return
 *          The new thread id.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.createNewThreadId = function(accountKey) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "createNewThreadId", {"action" : "start"});
    }

    var connection = this.getDatabaseConnection(accountKey);
    var statement = connection.createStatement(
        "SELECT threadid FROM threadcounter");

    var threadId = null;
    try {
        if (statement.executeStep()) {
            threadId = statement.getInt32(0);
        }
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
    }

    // check if thread id exists
    var exists = true;
    if (threadId == null) {
        threadId = 0;
        exists = false;
    }

    // increment thread id
    threadId++;

    // if thread id already existed, update to new value, otherwise
    // insert the first id
    if (exists) {
        statement = connection.createStatement(
            "UPDATE threadcounter SET threadid = ?");
    } else {
        statement = connection.createStatement(
        "INSERT INTO threadcounter (threadid) VALUES (?)");
    }
    statement.bindInt32Parameter(0, threadId);
    try {
        statement.execute();
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
    }

    connection = null;
    delete connection;

    return threadId;
}



/** ****************************************************************************
 * Write thread to database
 * @param accountKey
 *          The account key to create the database connection.
 * @param threadId
 *          The thread id to write
 * @param threadIds
 *          Other thread ids to use. Add all messages from those
 *          thread ids as well.
 * @param messageIds
 *          The array of message ids to add to the thread
 ******************************************************************************/
ThreadVisNS.Cache.prototype.storeThread = function(accountKey, threadId,
    threadIds, messageIds) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "storeThread", {"action" : "start"});
    }

    var connection = this.getDatabaseConnection(accountKey);
    var statement = null;

    // first, fetch all additional messages from threadIds
    statement = connection.createStatement(
        "SELECT msgid FROM threads WHERE threadid = ?");
    for (var i = 0; i < threadIds.length; i++) {
        statement.bindInt32Parameter(0, threadIds[i]);
        try {
            while (statement.executeStep()) {
                var msgid = statement.getString(0);
                messageIds.push(msgid);
            }
        } catch (ex) {
            THREADVIS.logger.log("Error while performing SQL statement", {
                "exception": ex});
        }
        statement.reset();
    }
    statement.reset();
    statement = null;

    // delete all unused thread ids
    statement = connection.createStatement(
        "DELETE FROM threads WHERE threadid = ?");
    for (var i = 0; i < threadIds.length; i++) {
        try {
            statement.bindInt32Parameter(0, threadIds[i]);
            statement.execute();
            statement.reset();
        } catch (ex) {
            THREADVIS.logger.log("Error while performing SQL statement", {
                "exception": ex});
        }
    }
    statement.reset();
    statement = null;

    // for all message ids in the cache, write to database
    statement = connection.createStatement(
        "INSERT INTO threads (msgid, threadid) VALUES (?, ?)");
    try {
        var msgId = null;
        for (var i = 0; i < messageIds.length; i++) {
            statement.bindStringParameter(0, messageIds[i]);
            statement.bindInt32Parameter(1, threadId);
            statement.execute();
        }
    } catch (ex) {
        // ignore any exceptions, as we might insert message ids multiple times
    } finally {
        statement.reset();
        statement = null;
    }
}



/** ****************************************************************************
 * Get the update timestamp for a folder
 * @param accountKey
 *          The account key to create the database connection.
 * @param folderuri
 *          The folder URI.
 * @return
 *          The last update timestamp.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getFolderUpdateTimestamp = function(accountKey,
    folderuri) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "getFolderUpdateTimestamp", {"action" : "start"});
    }

    var connection = this.getDatabaseConnection(accountKey);
    var statement = connection.createStatement(
        "SELECT updatetimestamp FROM updatetimestamps WHERE folderuri = ?");

    var updatetimestamp = 0;
    try {
        statement.bindStringParameter(0, folderuri);
        if (statement.executeStep()) {
            updatetimestamp = parseInt(statement.getString(0));
        }
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
        connection = null;
        delete connection;
    }

    return updatetimestamp;
}



/** ****************************************************************************
 * Set the update timestamp for a folder
 * @param accountKey
 *          The account key to create the database connection.
 * @param folderuri
 *          The folder URI.
 * @param timestamp
 *          The timestamp to set.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.setFolderUpdateTimestamp = function(accountKey,
    folderuri, timestamp) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.COMPONENT_CACHE)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFO,
            "setFolderUpdateTimestamp", {"action" : "start"});
    }

    var connection = this.getDatabaseConnection(accountKey);

    var statement = connection.createStatement(
        "DELETE FROM updatetimestamps WHERE folderuri = ?");
    try {
        statement.bindStringParameter(0, folderuri);
        statement.execute();
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
    }

    statement = connection.createStatement(
        "INSERT INTO updatetimestamps (folderuri, updatetimestamp) VALUES (?,?)");

    var updatetimestamp = 0;
    try {
        statement.bindStringParameter(0, folderuri);
        statement.bindStringParameter(1, timestamp);
        statement.execute();
    } catch (ex) {
        THREADVIS.logger.log("Error while performing SQL statement", {
            "exception": ex});
    } finally {
        statement.reset();
        statement = null;
        delete statement;
        connection = null;
        delete connection;
    }

    return updatetimestamp;
}



/** ****************************************************************************
 * Create account caches for all accounts
 ******************************************************************************/
ThreadVisNS.Cache.prototype.createAccountCaches = function() {
    // loop over all accounts
    var accountManager = Components.classes["@mozilla.org/messenger/account-manager;1"]
        .getService(Components.interfaces.nsIMsgAccountManager);
    var accounts = accountManager.accounts;

    for (var i = 0; i < accounts.Count(); i++) {
        // check enabled account
        if (this.isAccountEnabled(accounts.GetElementAt(i))) {
            this.accountCaches[accounts.GetElementAt(i).key] =
                new ThreadVisNS.AccountCache(this, accounts.GetElementAt(i));
        }
    }
    accounts = null;
    delete accounts;
    accountManager = null;
    delete accountManager;
}



/** ****************************************************************************
 * Get all account caches
 ******************************************************************************/
ThreadVisNS.Cache.prototype.getAccountCaches = function() {
    return this.accountCaches;
}



/** ****************************************************************************
 * Check all accounts
 ******************************************************************************/
ThreadVisNS.Cache.prototype.checkAllAccounts = function() {
    // TODO THIS IS BROKEN
    return;
    var accountCache = null;
    for (var i = 0; i < this.accountCaches.length; i++) {
        var status = this.accountCaches[i].status();
        if (status.doneChecking || status.working) {
            continue;
        }
        accountCache = this.accountCaches[i];
        break;
    }

    if (accountCache) {
        var ref = this;
        accountCache.register("onCheckDone", function() {
            ref.checkAllAccounts();
        });
        accountCache.check();
    } else {
        // check done
        alert("check for all accounts done");
    }
}



/** ****************************************************************************
 * Check account for any uncached messages
 *
 * @param accountKey
 *          The accountkey to check
 * @param folder
 *          An optional folder to check. If not set, all folders are checked.
 ******************************************************************************/
ThreadVisNS.Cache.prototype.checkAccount = function(accountKey, folder) {
    var accountCache = this.accountCaches[accountKey];
    /*for (var i = 0; i < this.accountCaches.length; i++) {
        if (this.accountCaches[i].account = account) {
            accountCache = this.accountCaches[i];
            break;
        }
    }*/

    if (accountCache) {
        var ref = this;
        accountCache.register("onCheckDone", function() {
            accountCache.cacheUncachedMessages();
        });
        accountCache.register("onCacheDone", function() {
            ref.onCacheDone();
        });
        accountCache.check(folder);
    }
}



/** ****************************************************************************
 * Is account enabled
 ******************************************************************************/
ThreadVisNS.Cache.prototype.isAccountEnabled = function(account) {
    if (this.threadvis.preferences.getPreference(
        this.threadvis.preferences.PREF_DISABLED_ACCOUNTS) != ""
            && this.threadvis.preferences.getPreference(this.threadvis.preferences.PREF_DISABLED_ACCOUNTS).indexOf(" " + account.key + " ") > -1) {
        return false;
    }
    return true;
}



/** ****************************************************************************
 * Cancel all caching activity
 ******************************************************************************/
ThreadVisNS.Cache.prototype.cancel = function() {
    for (var key in this.accountCaches) {
        this.accountCaches[key].cancel();
    }
    /*for (var i = 0; i < this.accountCaches.length; i++) {
        this.accountCaches[i].cancel();
    }*/
}



/** ****************************************************************************
 * Called after caching is done
 ******************************************************************************/
ThreadVisNS.Cache.prototype.onCacheDone = function() {
    this.notify("onCacheDone");
}



/** ****************************************************************************
 * Register for callback
 ******************************************************************************/
ThreadVisNS.Cache.prototype.register = function(event, callback) {
    if (! this.callbacks[event]) {
        this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
}



/** ****************************************************************************
 * Notify callbacks
 ******************************************************************************/
ThreadVisNS.Cache.prototype.notify = function(event) {
    if (! this.callbacks[event]) {
        return;
    }
    for (var i = 0; i < this.callbacks[event].length; i++) {
        this.callbacks[event][i]();
    }
    this.callbacks[event] = null;
    delete this.callbacks[event];
}



/** ****************************************************************************
 * Cache a single uncached message
 *
 * @param message
 *          The message to cache
 * @param accountKey
 *          The account key
 ******************************************************************************/
ThreadVisNS.Cache.prototype.cacheMessage = function(message, accountKey) {
    // get the references header
    var messageIds = [];
    messageIds.push(message.messageId);
    // TODO also evaluate in-reply-to header!
    messageIds = messageIds.concat((new ThreadVisNS.References(
        message.getStringProperty("references"))).getReferences());

    // try to get existing thread ids for any of the message-ids in references
    var threadIds = this.getThreadIdsForMessageIds(accountKey, messageIds);

    // re-use first thread id or create new one if none was found
    var threadId = null;
    if (threadIds.length == 0) {
        // no thread id was found, create a new one
        threadId = this.createNewThreadId(accountKey);
    } else {
        // use first thread id
        threadId = threadIds[0];
    }

    // write cache data
    this.storeThread(accountKey, threadId, threadIds, messageIds);
}
