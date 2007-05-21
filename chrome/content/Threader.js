/** ****************************************************************************
 * Threader.js
 *
 * (c) 2005-2007 Alexander C. Hubmann
 * (c) 2007 Alexander C. Hubmann-Haidvogel
 *
 * based on the algorithm from Jamie Zawinski <jwz@jwz.org>
 * www.jwz.org/doc/threading.html
 *
 * $Id$
 ******************************************************************************/



/** ****************************************************************************
 * Constructor
 ******************************************************************************/
function Threader() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_INFORM)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFORM, "Threader()", {});
    }
    
    /**
     * Link message ids to container objects
     */
    this.idTable = new Object();
    
    /**
     * Messages to be processes
     */
    this.messages = new Object();
    
    /**
     * The set of all root threads
     */
    this.rootSet = new Container(true);
    
    this.subjectTable = new Object();
    
    // copy/cut object
    this.copycut = new CopyCut();
}



/** ****************************************************************************
 * Add a new message
 * @param message The new Message to add
 ******************************************************************************/
Threader.prototype.addMessage = function(message) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL, "Threader.addMessage()", {"message" : message});
    }
    this.messages[message.getId()] = message;
}



/** ****************************************************************************
 * Add a new message
 * construct message here
 ******************************************************************************/
Threader.prototype.addMessageDetail = function(subject, author, messageId,
    messageKey, date, uri, references, issent) {
    this.addMessage(new Message(subject, author, messageId, messageKey, date, 
        uri, references, issent));
}



/** ****************************************************************************
 * Find a message
 ******************************************************************************/
Threader.prototype.closeCopyCut = function() {
    this.copycut.write();
    this.copycut.close();
}



/** ****************************************************************************
 * Find a message
 ******************************************************************************/
Threader.prototype.findContainer = function(messageId) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL, "Threader.findContainer()",
            {"message_id" : messageId, "return" : this.idTable[messageId]});
    }
    return this.idTable[messageId];
}



/** ****************************************************************************
 * Get root container
 ******************************************************************************/
Threader.prototype.getRoot = function() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_INFORM)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFORM, "Threader.getRoot()", {});
    }
    return this.rootSet;
}



/** ****************************************************************************
 * put all messages in a container
 * loop over all messages
 * use setTimeout to give mozilla time
 ******************************************************************************/
Threader.prototype.putMessagesInContainer = function() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_INFORM)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFORM,
            "Threader.putMessagesInContainer()",
            {"action" : "loop over all messages", "messages.length" : this.messages.length});
    }
    
    for (var id in this.messages) {
        var message = this.messages[id];
        this.totalMessages++;
        this.putMessageInContainer(message);
    }
}



/** ****************************************************************************
 * put this message in a container
 ******************************************************************************/
Threader.prototype.putMessageInContainer = function(message) {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL, 
            "Threader.putMessageInContainer()", {"looking at" : message});
    }
    
    // try to get message container
    var messageContainer = this.idTable[message.getId()];
    
    if (messageContainer != null) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()", {"action" : "found dummy container with message id",
                "dummy" : messageContainer.message == null,
                "sent" : messageContainer.message == null ? "false" : messageContainer.getMessage().isSent()});
        }
        
        // if we found a container for this message id, either it's a dummy
        // or we have two mails with the same message-id
        // this should only happen if we sent a mail to a list and got back
        // our sent-mail in the inbox
        // in that case we want that our sent-mail takes precedence over
        // the other, since we want to display it as sent, and we only want
        // to display it once
        if (messageContainer.isDummy() ||
           (! messageContainer.isDummy() &&
            ! messageContainer.getMessage().isSent())) {
            // 1.A. id_table contains empty container for this message
            // store message in this container
            messageContainer.setMessage(message);
            // index container in hashtable
            this.idTable[message.getId()] = messageContainer;
        } else if (! messageContainer.isDummy() && messageContainer.getMessage().isSent()) {
            // the message in message_container is a sent message,
            // the new message is not the sent one
            // in this case we simply ignore the new message, since
            // the sent message takes precedence
            return;
        } else {
            messageContainer = null;
        }
    }
    
    if (messageContainer == null) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()",
                {"action" : "no container found, create new one"});
        }
        
        // no suitable container found, create new one
        messageContainer = new Container();
        messageContainer.setMessage(message);
        // index container in hashtable
        this.idTable[message.getId()] = messageContainer;
    }
    
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
            "Threader.putMessageInContainer()", {"action" : "loop over references"});
    }
    
    // for each element in references field of message
    var parentReferenceContainer = null;
    var parentReferenceId = "";
    var references = message.getReferences().getReferences();
    
    for (referencekey in references) {
        var referenceId = references[referencekey];
    
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()", {"reference" : referenceId});
        }
        
        // try to find container for referenced message
        var referenceContainer = this.idTable[referenceId];
        if (referenceContainer == null) {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.putMessageInContainer()", {"action" : "no container found, create new one"});
            }
            
            // no container found, create new one
            referenceContainer = new Container();
            // index container
            this.idTable[referenceId] = referenceContainer;
        }
        
        // 1.B. link reference container together
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()", {"action" : "link references together"});
        }
        
        if (parentReferenceContainer != null &&                         // if we have a parent container
            ! referenceContainer.hasParent() &&                         // and current container does not have a parent
            parentReferenceContainer != referenceContainer &&           // and we are not looking at the same container
            ! referenceContainer.findParent(parentReferenceContainer)) {// see if we are already a child of parent
            // check if this reference is overridden by a cut
            // (i.e. thread is split by user)
            if (this.copycut.getCut(referenceId) == parentReferenceId) {
                if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                    THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                        "Threader.putMessageInContainer()", {"action" : "message cut, do not add us to parent"});
                    }
            } else {
                if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                    THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                        "Threader.putMessageInContainer()", {"action" : "add us to parent reference container"});
                }
                parentReferenceContainer.addChild(referenceContainer);
            }
        }
        parentReferenceContainer = referenceContainer;
        parentReferenceId = referenceId;
    }
    
    // set parent of current message to last element in references
    
    // if we have a suitable parent container, and the parent container is the current container
    // or the parent container is a child of the current container, discard it as parent
    if (parentReferenceContainer != null && (parentReferenceContainer == messageContainer ||
        parentReferenceContainer.findParent(messageContainer))) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL, "Threader.putMessageInContainer()",
                {"action" : "set parent reference container to null"});
        }
        parentReferenceContainer = null;
    }
    
    // if current message already has a parent
    if (messageContainer.hasParent() && parentReferenceContainer != null) {
        // remove us from this parent
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()", {"action" : "remove us from parent"});
        }
        
        messageContainer.getParent().removeChild(messageContainer);
    }
    
    // get copy
    // check if user added a new reference, if so, add us to this parent
    // previous relation should have been taken care of by a cut
    var copyId = this.copycut.getCopy(message.getId());
    if (copyId) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putMessageInContainer()", {"action" : "message copied", "copy_id" : copyId});
        }
        
        var parentContainer = this.idTable[copyId];
        if (parentContainer == null) {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.putMessageInContainer()", {"action" : "no container found, create new one"});
            }
            
            // no container found, create new one
            parentContainer = new Container();
            // index container
            this.idTable[copyId] = parentContainer;
        }
        
        parentContainer.addChild(messageContainer);
    } else {
        // if we have a suitable parent
        if (parentReferenceContainer != null) {
            // and this container wasn't cut
            if (this.copycut.getCut(message.getId()) == parentReferenceId) {
                if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                    THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                        "Threader.putMessageInContainer()", {"action" : "message cut, do not add us to parent"});
                }
            } else {
                // add us as child
                if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                    THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                     "Threader.putMessageInContainer()", {"action" : "add us as child to parent reference container"});
                }
                
                parentReferenceContainer.addChild(messageContainer);
            }
        }
    }
}



/** ****************************************************************************
 * Find the root set
 * These are all containers which have no parent
 ******************************************************************************/
Threader.prototype.findRootSet = function() {
    var rootKey = null;
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_INFORM)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_INFORM,
            "Threader.findRootSet()", {"action" : "find root set"});
    }
    
    for (rootKey in this.idTable) {
        var container = this.idTable[rootKey];
        if (! container.hasParent()) {
           // root set contains all containers that have no parents
           this.rootSet.addChild(container);
        }
    }
}



/** ****************************************************************************
 * Find a message
 ******************************************************************************/
Threader.prototype.hasMessage = function(messageId) {
    if (this.messages[messageId]) {
        return true;
    }
    
    if (this.idTable[messageId]) {
        return true;
    }
    
    return false;
}



/** ****************************************************************************
 * Prune all empty containers
 * do recursive pruneing on all containers
 ******************************************************************************/
Threader.prototype.pruneEmptyContainers = function() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
            "Threader.pruneEmptyContainers()", {"action" : "loop over root set"});
    }
    
    var container = null;
    for (container = this.rootSet.getChild(); container != null; container = container.getNext()) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.pruneEmptyContainers()", {"container" : container});
        }
        // if container is empty and has no children
        if (container.isDummy() && ! container.hasChild()) {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.pruneEmptyContainers()", {"action" : "container does not belong to root set"});
            }
            // remove from root_set_
            if (container.hasPrevious()) {
                container.getPrevious().setNext(container.getNext());
            } else {
                container.getParent().setChild(container.getNext());
            }
            
            continue;
        }
        // if the container has no message, but children
        // actually we want to keep this dummy to preserve structure
        
        // recursively prune empty containers
        container.pruneEmptyContainers();
    }
}



/** ****************************************************************************
 * Put all containers in subject table
 * always put topmost container in subject table
 * (i.e. container which is "least" reply
 ******************************************************************************/
Threader.prototype.putContainersInSubjectTable = function() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
            "Threader.putContainersInSubjectTable()", {"action" : "loop over root set"});
    }
    
    var container = null;
    for (container = this.rootSet.getChild(); container != null; container = container.getNext()) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.putContainersInSubjectTable()", {"container" : container});
        }
        // 5.B. find subject of subtree
        var subject = "";
        subject = container.getSimplifiedSubject();
        
        if (subject == "") {
            // in case of empty subject, give up on this container
            continue;
        }
        
        // try to find existing container with same subject
        var subjectContainer = this.subjectTable[subject];
        
        if (subjectContainer == null ||                                       // if we have to container with this subject OR
           (subjectContainer.isDummy() && ! container.isDummy()) ||           // if found one is empty, but this one is not OR
           (subjectContainer.getReplyCount() > container.getReplyCount()))    // if current is less reply than subject container
        {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.putContainersInSubjectTable()", {"action" : "putting container in subject table"});
            }
            this.subjectTable[subject] = container;
        }
    }
}



/** ****************************************************************************
 * Group all containers by subject
 ******************************************************************************/
Threader.prototype.groupBySubject = function() {
    if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
        THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
            "Threader.groupBySubject()", {"action" : "loop over root set"});
    }
    
    var container = null;
    for (container = this.rootSet.getChild(); container != null; container = container.getNext()) {
        if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
            THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                "Threader.groupBySubject()", {"container" : container});
        }
        // get subject of this container
        var subject = "";
        subject = container.getSimplifiedSubject();
        
        // get container for this subject in subject_table
        var subjectContainer = this.subjectTable[subject];
        if (subjectContainer == null ||
            subjectContainer == container) {
            // if no container found, or found ourselfs
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()",
                    {"action" : "no container in subject table or found ourselves"});
            }
            continue;
        }
        // if both containers are dummies
        if (container.isDummy() &&
            subjectContainer.isDummy()) {
            // append children of subject_container to container
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()", {"action" : "both dummies"});
            }
            container.addChild(subjectContainer.getChild());
        }
        // if container is dummy, subject container no dummy
        else if (container.isDummy() && ! subjectContainer.isDummy()) {
            // add non empty container as child of empty container
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()", {"action" : "container dummy, subject_container not"});
            }
            container.addChild(subjectContainer);
        }
        // if container is no dummy but subject container is dummy
        else if (! container.isDummy() && subjectContainer.isDummy()) {
            // add non empty container as child of empty container
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()", {"action" : "container not dummy, subject_container dummy"});
            }
            subjectContainer.addChild(container);
        }
        // if containers are misordered, change order
        else if (! subjectContainer.isDummy() &&
            subjectContainer.getReplyCount() < container.getReplyCount()) {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()", {"action" : "misordered 1"});
            }
            // calculate difference between the messages
            var difference = container.getReplyCount() - subjectContainer.getReplyCount();
            var top = subjectContainer;
            while (difference > 1) {
                // insert dummy containers for missing messages
                difference--;
                var newContainer = null;
                // if container has child, use that
                if (top.hasChild()) {
                    newContainer = top.getChild();
                }
                // otherwise create dummy container
                else {
                    newContainer = new Container();
                    top.addChild(newContainer);
                }
                top = newContainer;
            }
            // add current container as child
            // if top has a dummy container, merge us in there
            if (top.hasDummy()) {
                dummy = top.getDummy();
                top.mergeChild(dummy, container);
            }
            // otherwise just add us as child
            else {
                top.addChild(container);
            }
            
            // remove us from root set
            if (container.hasPrevious()) {
                container.getPrevious().setNext(container.getNext());
            } else {
                container.getParent().setChild(container.getNext());
            }
        }
        // misordered again
        else if (! subjectContainer.isDummy() &&
            subjectContainer.getReplyCount() > container.getReplyCount()) {
            if (THREADVIS.logger.isDebug(THREADVIS.logger.LEVEL_EMAIL)) {
                THREADVIS.logger.logDebug(THREADVIS.logger.LEVEL_EMAIL,
                    "Threader.groupBySubject()", {"action" : "misordered 2"});
            }
            // calculate difference between the messages
            var difference = subjectContainer.getReplyCount() - container.getReplyCount();
            var top = container;
            while (difference > 1) {
                // insert dummy containers for missing messages
                difference--;
                var newContainer = null;
                // if container has child, use that
                if (top.hasChild()) {
                    newContainer = top.getChild();
                }
                // otherwise create dummy container
                else {
                    newContainer = new Container();
                    top.addChild(newContainer);
                }
                top = newContainer;
            }
            
            // add current container as child
            // if top has a dummy container, merge us in there
            if (top.hasDummy()) {
                dummy = top.getDummy();
                top.mergeChild(dummy, subjectContainer);
            }
            // otherwise just add us as child
            else {
                top.addChild(subjectContainer);
            }
        }
        // if none of the above, create new dummy container and add both as children
        else {
            // remove both from list of siblings
            
            var newContainer = new Container();
            
            var tmp = container.getPrevious();
            newContainer.addChild(container);
            newContainer.addChild(subjectContainer);
            this.rootRet.addChild(newContainer);
            container = tmp;
        }
    }
}



/** ****************************************************************************
 * Thread all messages
 ******************************************************************************/
Threader.prototype.thread = function() {
    // open copy/cut database
    this.copycut.read();
    
    this.start = (new Date()).getTime();
    THREADVIS.logger.log("threader", {"action" : "start"});
    // 1. For each message
    //this.id_table_ = new Object();
    this.putMessagesInContainer();
    
    // 2. Find the root set
    // walk over all elements in id_table
    this.findRootSet();
    
    // 3. Discard id_table
    // do not discard id_table_, we might need it to find individual messages
    //id_table_ = null;
    
    // 4. Prune empty containers
    // recursively walk all containers under root set
    // for each container
    this.pruneEmptyContainers();
    
    // 5. Group root set by subject
    // 5.A. create new hashtable for all subjects
    //this.subject_table_ = new Object();
    
    // 5.B. put all containers in subject table
    //this.topPutContainersInSubjectTable();
    
    // 5.C. group all containers by subject
    //this.topGroupBySubject();
    
    // 6. that's it
    //root_set_.check();
    
    // close copy/cut database
    this.copycut.close();
}



/** ****************************************************************************
 * Output root set as string
 ******************************************************************************/
Threader.prototype.toString = function() {
    var string = "\n-----\n";
    string += this.rootSet.toString("\n");
    return string;
}



/** ****************************************************************************
 * Log info about threading
 ******************************************************************************/
Threader.prototype.logInfo = function() {
    if (! THREADVIS.logger.doLogging()) {
        return;
    }
    
    var time_put_messages_in_container = this.put_messages_in_container_end_ -
                                         this.put_messages_in_container_start_;
    var time_find_rootset = this.find_rootset_end_ -
                            this.find_rootset_start_;
    var time_prune_empty_containers = this.prune_empty_containers_end_ -
                                      this.prune_empty_containers_start_;
    var time_put_containers_in_subject_table = this.put_containers_in_subject_table_end_ -
                                               this.put_containers_in_subject_table_start_;
    var time_group_by_subject = this.group_by_subject_end_ -
                                this.group_by_subject_start_;
    var time_total = this.end_ -
                     this.start_;
    
    //var total_messages = this.messages_.length;
    var total_messages = this.total_messages_;
    var time_per_message = time_total / total_messages;
    
    var num_threads = this.getRoot().getChildCount();
    var msg_per_thread = total_messages / num_threads;
    
    var distribution = this.getThreadDistribution();
    
    var timing = {"put messages in container" : time_put_messages_in_container,
                  "find root set" : time_find_rootset,
                  "prune empty containers" : time_prune_empty_containers,
                  "put containers in subject table" : time_put_containers_in_subject_table,
                  "group by subject" : time_group_by_subject,
                  "total" : time_total,
                  "per message" : time_per_message};
    
    THREADVIS.logger.log("threader",
                          {"action" : "end",
                           "total messages" : total_messages,
                           "total threads" : num_threads, 
                           "messages per thread" : msg_per_thread,
                           "distribution" : distribution,
                           "timing" : timing});
}



/** ****************************************************************************
 * get statistical info about message distribution
 ******************************************************************************/
Threader.prototype.getThreadDistribution = function() {
//    THREADVIS.logger_.logDebug(THREADVIS.logger_.LEVEL_INFORM_,
//                               "Threader.getThreadDistribution()",
//                               {});
    var distribution = new Array();
    var container = null;
    for (container = this.rootSet.getChild();
         container != null;
         container = container.getNext()) {
        var count = container.getCountRecursive();
        if (distribution[count]) {
            distribution[count]++;
        } else {
            distribution[count] = 1;
        }
    }
    return distribution;
}
