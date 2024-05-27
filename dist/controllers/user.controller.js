"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addContact = exports.getUserContacts = exports.getAllUsers = exports.searchUserbyPhoneNumber = exports.searchUserbyName = exports.login = exports.register = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const validators_1 = require("../validators");
// Prisma
const client_1 = require("@prisma/client");
const utils_1 = require("../utils");
const prisma = new client_1.PrismaClient();
// Register user
const register = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { name, phoneNumber, email, password, countryCode } = req.body;
    const { error } = validators_1.registerSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }
    // Validate the phone number
    if (!(0, validators_1.isValidPhoneNumber)(phoneNumber, countryCode)) {
        return res.status(400).json({ message: "Invalid phone number" });
    }
    const hashedPassword = bcrypt_1.default.hashSync(password, 10);
    try {
        // todo have an option to generate new contacts for registered users as well if they pass a argument
        const user = yield prisma.user.create({
            data: {
                name,
                phoneNumber,
                email,
                password: hashedPassword,
            },
        });
        // Generate random contacts if autoGeneratedContacts is true
        if (req.body.autoGeneratedContacts) {
            yield (0, utils_1.generateContacts)(user.id);
        }
        const token = (0, utils_1.createToken)(user.id);
        //   For now return token
        res.status(201).json({ token: token });
    }
    catch (error) {
        if (error.code === "P2002") {
            // If phone number already exists
            return res.status(409).json({ message: "Phone number already exists" });
        }
        else {
            // Else pass it to error handling middleware
            next(error);
        }
    }
});
exports.register = register;
// Login User
const login = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { phoneNumber, password } = req.body;
    try {
        //   check for user existence
        const user = yield prisma.user.findUnique({
            where: {
                phoneNumber,
            },
        });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        //   Validate password
        const validPassword = bcrypt_1.default.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: "Invalid password" });
        }
        //   create token
        const token = (0, utils_1.createToken)(user.id);
        return res.status(200).json({ token });
    }
    catch (error) {
        next(error);
    }
});
exports.login = login;
// User Search by Name
/**
 * A user can search for a person by name in the global database. Search results display the name,
 * phone number and spam likelihood for each result matching that name completely or partially.
 * Results should first show people whose names start with the search query, and then people
 * whose names contain but don’t start with the search query.
 *
 * @param {Request} req The request object containing the name parameter.
 * @param {Response} res The response object containing the search results.
 * @param {NextFunction} next The next function to handle any errors.
 */
const searchUserbyName = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { name } = req.params;
    const { userId } = req;
    try {
        const firstUsers = yield prisma.user.findMany({
            where: {
                name: {
                    startsWith: name,
                },
            },
            select: {
                id: true,
                name: true,
                phoneNumber: true,
            },
        });
        const containUsers = yield prisma.user.findMany({
            where: {
                AND: [
                    { name: { contains: name } },
                    { name: { not: { startsWith: name } } },
                ],
            },
            select: {
                id: true,
                name: true,
                phoneNumber: true,
            },
        });
        const users = [...firstUsers, ...containUsers];
        if (!users.length) {
            return res.status(404).json({ message: "User not found" });
        }
        const userWithSpam = yield Promise.all(users.map((user) => __awaiter(void 0, void 0, void 0, function* () {
            const spam = yield prisma.spam.findUnique({
                where: {
                    phoneNumber: user.phoneNumber,
                },
            });
            return Object.assign(Object.assign({}, user), { spamLikelihood: (spam === null || spam === void 0 ? void 0 : spam.spamCount) || 0 });
        })));
        res.status(200).json({ users: userWithSpam });
    }
    catch (error) {
        next(error);
    }
});
exports.searchUserbyName = searchUserbyName;
// User Search by Phone Number
/**
 * A user can search for a person by phone number in the global database. If there is a registered
 * user with that phone number, show only that result. Otherwise, show all results matching that
 * phone number completely - note that there can be multiple names for a particular phone number
 * in the global database, since contact books of multiple registered users may have different names
 * for the same phone number.
 *
 * @param {Request} req The request object containing the phone number parameter.
 * @param {Response} res The response object containing the search results.
 * @param {NextFunction} next The next function to handle any errors.
 */
const searchUserbyPhoneNumber = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { phoneNumber } = req.params;
    try {
        // Check if the user is registered
        const registeredUser = yield prisma.user.findUnique({
            where: {
                phoneNumber,
            },
            select: {
                id: true,
                name: true,
                phoneNumber: true,
                email: true,
            },
        });
        if (registeredUser) {
            return res.status(200).json({ users: [registeredUser] });
        }
        // If the user is not registered check for it in contacts
        const contacts = yield prisma.contact.findMany({
            where: {
                phoneNumber,
            },
            select: {
                name: true,
                phoneNumber: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });
        if (!contacts.length) {
            return res.status(404).json({ message: "User not found" });
        }
        // Data formatting details for each contact
        const users = contacts.map((contact) => ({
            name: contact.name,
            phoneNumber: contact.phoneNumber,
            associatedUser: contact.user,
        }));
        res.status(200).json({ users });
    }
    catch (error) {
        next(error);
    }
});
exports.searchUserbyPhoneNumber = searchUserbyPhoneNumber;
// Get all users
const getAllUsers = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const users = yield prisma.user.findMany();
        res.status(200).json({ users });
    }
    catch (error) {
        next(error);
    }
});
exports.getAllUsers = getAllUsers;
// Get user contacts by name
const getUserContacts = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { name } = req.params;
    try {
        // Search for the user name starts with the search query
        const user = yield prisma.user.findMany({
            where: {
                name: {
                    startsWith: name,
                },
            },
            select: {
                id: true,
            },
        });
        const contacts = yield Promise.all(user.map((user) => prisma.contact.findMany({
            where: {
                userID: user.id,
            },
        })));
        res.status(200).json({ contacts });
    }
    catch (error) {
        next(error);
    }
});
exports.getUserContacts = getUserContacts;
// Add contact to user
const addContact = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { userID, phoneNumber, name, countryCode } = req.body;
    const { error } = validators_1.contactSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }
    // Validate phone number
    if (!(0, validators_1.isValidPhoneNumber)(phoneNumber, countryCode)) {
        return res.status(400).json({ message: "Invalid phone number" });
    }
    // check the phone number exist in the current user contacts or not
    const existContact = yield prisma.contact.findFirst({
        where: {
            AND: [{ phoneNumber: phoneNumber }, { userID: userID }],
        },
    });
    if (existContact) {
        return res.status(400).json({ message: "Contact already exists" });
    }
    try {
        const contact = yield prisma.contact.create({
            data: {
                name,
                phoneNumber,
                userID,
            },
        });
        res.status(200).json({ contact });
    }
    catch (error) {
        next(error);
    }
});
exports.addContact = addContact;
//# sourceMappingURL=user.controller.js.map