'use strict';

const {
    Model
} = require('sequelize');

module.exports = function(sequelize, DataTypes) {
    var Message = sequelize.define('Message', {
        eventId: DataTypes.INTEGER,
        parentId: DataTypes.INTEGER,
        chatThreadId: DataTypes.INTEGER,
        messageType: {
            type: DataTypes.ENUM('text', 'tip', 'image', 'file'),
            defaultValue: 'text'
        },
        message: DataTypes.STRING,
        userId: DataTypes.INTEGER,
        chatUserId: DataTypes.INTEGER,
        name: DataTypes.STRING,
        banned: DataTypes.BOOLEAN,
        data: DataTypes.JSON,
        deleted: DataTypes.BOOLEAN,
        read: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        senderIp: {
            type: DataTypes.STRING,  defaultValue: null 
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE
    }, {
        classMethods: {
        },
        tableName: 'MESSAGES'
    });

    return Message;
};

/**
 * Helper method for defining associations.
 * This method is not a part of Sequelize lifecycle.
 * The `models/index` file will call this method automatically.
 */
