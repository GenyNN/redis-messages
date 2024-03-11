const Message = require('../models').Message;

const {RolesEnum} = require('../entity/RolesEnum');

const { SchemaFieldTypes } = require('redis');

let redisClient = require('../components/Redis');

class ChatController {

    static async initialize() {
        await redisClient.connect();
        try {
            await redisClient.ft.create('idx:messages', {
                    userId: SchemaFieldTypes.NUMERIC,
                    messageType: SchemaFieldTypes.TEXT,
                    chatThreadId: SchemaFieldTypes.NUMERIC,
                    chatUserId: SchemaFieldTypes.NUMERIC,
                    message: SchemaFieldTypes.TEXT,
                    deleted: SchemaFieldTypes.NUMERIC,
                    createdAt: SchemaFieldTypes.NUMERIC
                },
                {
                    ON: 'HASH',
                    PREFIX: 'messages'
                }
            );
        }
        catch (e) {
            if (e.message === 'Index already exists') {
                console.log('Index exists already, skipped creation.');
            } else {
                // Something went wrong, perhaps RediSearch isn't installed...
                console.error(e);
                process.exit(1);
            }
        }
    }

    static messages = async (req, res) => {
        let { id } = req.params;
        let {limit, onlyOwn, userId} = req.body;
        let currentUser = req.session.user ? req.session.user : null;
        if (!currentUser)
            return;

        let searchCriteria = ChatController.prepareSearchCriteria(id, limit, onlyOwn, userId, currentUser);

        if (currentUser.typeId == RolesEnum.API) {
            Message.findAll(searchCriteria).then( (messages) => ChatController.handleSQLReadMessages(messages, currentUser) ).then( (respMessages) => {
                res.send(respMessages);
            });
        }
        else {       
            ChatController.handleRedisReadMessages(searchCriteria, currentUser).then( (filteredMessages) => {
                redisClient.hSet(`RMC:${id}`, currentUser.id, 0);
                res.send({success: true, data: filteredMessages});
            });
        }
    }

    static handleSQLReadMessages = async (messages, currentUser) => {
        let mappedMessages = [];
                let idsRead = [];
                if (messages.length) {
                    mappedMessages = messages.map((mes) => { 
                        let jsonObj = null;
                        try {
                            jsonObj = JSON.parse(mes.data);
                        }
                        catch(e) {
                            jsonObj = null;
                        }
                        mes.data = !jsonObj || jsonObj == '' ? {} : jsonObj;
                        if ( (mes.userId != currentUser.id) ) {
                            if (!mes.read) {
                                idsRead.push(mes.id);
                            }
                        }
                        return mes;
                    });
                }
                if (idsRead.length) {
                    await Message.update(
                        { read: true },
                        {
                          where: {
                            id: idsRead,
                          },
                        }
                    );
                }
                let respMessages = { success: true, data: mappedMessages};

                return respMessages;
    }

    static handleRedisReadMessages = async (searchCriteria, currentUser) => {
        let whereCriteria = searchCriteria.where;
        let redisArrParams = [];
        let redisStrParams = "";
        redisArrParams = ChatController.prepareRedisSearchParams(whereCriteria);

        
        redisStrParams = redisArrParams.join(" ");
        let respMessages = await redisClient.ft.search('idx:messages', redisStrParams, {
                LIMIT: {
                    from: 0,
                    size: searchCriteria.limit
                },
                SORTBY: {
                    BY: searchCriteria.order[0][0],
                    DIRECTION: searchCriteria.order[0][1]
                }    
        });

        let importMulti = redisClient.multi();

        let shouldRedisUpdate = ChatController.isShouldUpdateMessagesInTransaction(respMessages, importMulti, currentUser);

        let filteredMessages = ChatController.filterAndMapMessages(respMessages);

        ChatController.execTransactionMessagesUpdate(shouldRedisUpdate, importMulti);
        return filteredMessages; 
    }
    
    static isShouldUpdateMessagesInTransaction = (respMessages, importMulti, currentUser) => {
        let isUpdate = false;
        respMessages.documents.forEach(mes => {
            if ( parseInt(mes.value.userId) != currentUser.id )  {
                if (!mes.value.read) {
                    importMulti.hSet(mes.id, {
                        "read": 1,
                    });
                    isUpdate = true;
                }
            }
        });
        return isUpdate;
    }

    static filterAndMapMessages = (respMessages) => {
        let filteredMessages = respMessages.documents.map((o) => { 
            let jsonObj = null;
            try {
                jsonObj = JSON.parse(o.value.data);
            }
            catch(e) {
                jsonObj = null;
            }
            o.value.data = !jsonObj || jsonObj == '' ? {} : jsonObj;
            o.value.banned = o.value.banned > 0 ? true : false;
            o.value.deleted = o.value.deleted > 0 ? true : false;
            o.value.read = o.value.read > 0 ? true : false;
            return o.value;
        });
        return filteredMessages;
    }

     static execTransactionMessagesUpdate = (redisUpdate, importMulti) => {
        if (redisUpdate) {
            importMulti.exec(function(err,results){
                if (err) { throw err; } else {
                  //this will log the results of the all hmsets:
                  //[ ‘OK’, ‘OK’, ‘OK’, ‘OK’, ‘OK’ ]
                  //Not very useful… yet!
                  console.log(results);
                  client.quit();
                 }
            });
        }
    }

    static prepareRedisSearchParams = (whereCriteria) => {
        let  redisSearchParams = "";
        redisSearchParams = Object.entries(whereCriteria).map(([key, value]) => {
            let resParam = null;
            if (typeof value == "boolean") {
                let bval = value == true ? 1 : 0;
                resParam = `@${key}: [${bval} ${bval}]`;
            }
            else {
                resParam = `@${key}: [${value} ${value}]`;
            }
    
            return resParam;
        });
        return redisSearchParams;
    }
    
    static prepareSearchCriteria = (id, limit, onlyOwn, userId, currentUser) => {
        
        if (limit == null || limit == undefined)
            limit = 25;

        if (currentUser.typeId != RolesEnum.API && currentUser.typeId != RolesEnum.ADMIN) {
            if (limit > 1000) {
                limit = 1000;
            }
        }
        if (onlyOwn == null || onlyOwn == undefined)
            onlyOwn = false;

        let searchCriteria;
        let whereCriteria = {
            chatThreadId: id
        };

        if (onlyOwn) {
            whereCriteria['userId'] = currentUser.id;
        }
        else if (userId !== null && userId !== undefined) {
            whereCriteria['userId'] = userId;
        }
        if (currentUser.typeId != RolesEnum.API && currentUser.typeId != RolesEnum.ADMIN) {
            whereCriteria['deleted'] = false;
        }

        searchCriteria = {
            where: whereCriteria,
            limit: limit,
            order: [['createdAt', 'DESC']]
        }

        return searchCriteria;
    }

    static chatsMessages = async (req, res) => {
        res.send({success: true});
    }

}

export default ChatController;