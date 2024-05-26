import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import registerSchema from "../validators/registerSchema";
// Prisma
import { PrismaClient } from "@prisma/client";
import { createToken } from "../utils";
const prisma = new PrismaClient();

// Register user
export const register = async (req: Request, res: Response, next: NextFunction) => {
      const { error } = registerSchema.validate(req.body);
      if (error) {
            return res.status(400).json({ message: error.details[0].message });
      }
      const { name, phoneNumber, email, password } = req.body;
      console.log(name, phoneNumber, email, password);
      const hashedPassword = bcrypt.hashSync(password, 10);

      try {
            // todo have an option to generate new contacts for registered users as well if they pass a argument
            const user = await prisma.user.create({
                  data: {
                        name,
                        phoneNumber,
                        email,
                        password: hashedPassword,
                  },
            });
            const token = createToken(user.id);
            //   For now return token
            res.status(201).json({ token: token });
      } catch (error: any) {
            if (error.code === "P2002") {
                  // If phone number already exists
                  return res.status(409).json({ message: "Phone number already exists" });
            } else {
                  // Else pass it to error handling middleware
                  next(error);
            }
      }
};
export const login = async (req: Request, res: Response, next: NextFunction) => {
      const { phoneNumber, password } = req.body;
      try {
            //   check for user existence
            const user = await prisma.user.findUnique({
                  where: {
                        phoneNumber,
                  },
            });
            if (!user) {
                  return res.status(404).json({ message: "User not found" });
            }
            //   Validate password
            const validPassword = bcrypt.compareSync(password, user.password);
            if (!validPassword) {
                  return res.status(401).json({ message: "Invalid password" });
            }
            //   create token
            const token = createToken(user.id);
            return res.status(200).json({ token });
      } catch (error) {
            next(error);
      }
};

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
export const searchUserbyName = async (req: Request, res: Response, next: NextFunction) => {
      const { name } = req.params;
      try {
            // Search for the user name starts with the search query
            const firstUsers = await prisma.user.findMany({
                  where: {
                        name: {
                              startsWith: name,
                        },
                  },
                  select: {
                        name: true,
                        phoneNumber: true,
                        email: true,
                  },
            });
            // Search for the user name contains the search query
            const containUsers = await prisma.user.findMany({
                  where: {
                        AND: [
                              { name: { contains: name } },
                              { name: { not: { startsWith: name } } },
                        ],
                  },
                  select: {
                        name: true,
                        phoneNumber: true,
                        email: true,
                  },
            });

            const users = [...firstUsers, ...containUsers];
            if (!users.length) {
                  return res.status(404).json({ message: "User not found" });
            }

            // Spam likelihood

            const userWithSpam = await Promise.all(
                  users.map(async (user) => {
                        const spam = await prisma.spam.findUnique({
                              where: {
                                    phoneNumber: user.phoneNumber,
                              },
                        });
                        return { ...user, spamLikelihood: spam?.spamCount || 0 };
                  })
            );
            res.status(200).json({ users: userWithSpam });
      } catch (error) {
            next(error);
      }
};

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
export const searchUserbyPhoneNumber = async (req: Request, res: Response, next: NextFunction) => {
      const { phoneNumber } = req.params;
      try {
            // Check if the user is registered
            const registeredUser = await prisma.user.findUnique({
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
            const contacts = await prisma.contact.findMany({
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
      } catch (error) {
            next(error);
      }
};