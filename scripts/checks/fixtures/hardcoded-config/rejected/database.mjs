// Deliberately hard-coded database names of a fictional persistence layer.
export const connection = { database: "fixture_main" };
export const DATABASE_NAME = "fixture_db";
export const testDbName = "fixture_test";
export const connectionString = "postgres://fixture@db.example.invalid/fixture";
export const statement = "CREATE DATABASE fixture_copy";
export const fromEnvironment = process.env.DATABASE_NAME || "fixture";
