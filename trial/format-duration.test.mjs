import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

import { formatDuration } from "./format-duration.mjs";

const MESSAGE = "minutes must be a non-negative integer";

function assertRejects(value) {
  assert.throws(
    () => formatDuration(value),
    (error) => error instanceof RangeError && error.message === MESSAGE,
    `expected a RangeError for ${inspect(value)}`,
  );
}

test("formats less than an hour in minutes", () => {
  assert.equal(formatDuration(45), "45 min");
});

test("formats hours and remaining minutes", () => {
  assert.equal(formatDuration(90), "1 h 30 min");
});

test("leaves out the minutes on a whole number of hours", () => {
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(60), "1 h");
});

test("formats zero as minutes", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(-0), "0 min");
});

test("formats minutes just below and above an hour", () => {
  assert.equal(formatDuration(59), "59 min");
  assert.equal(formatDuration(61), "1 h 1 min");
});

test("formats durations of a day or more in hours", () => {
  assert.equal(formatDuration(1440), "24 h");
  assert.equal(formatDuration(1500), "25 h");
  assert.equal(formatDuration(1501), "25 h 1 min");
});

test("rejects a negative number", () => {
  assertRejects(-1);
  assertRejects(-60);
});

test("rejects a non-integer", () => {
  assertRejects(1.5);
  assertRejects(0.1);
  assertRejects(Infinity);
  assertRejects(-Infinity);
});

test("formats the largest safe integer exactly", () => {
  assert.equal(formatDuration(Number.MAX_SAFE_INTEGER), "150119987579016 h 31 min");
});

test("rejects an integer above Number.MAX_SAFE_INTEGER", () => {
  assertRejects(Number.MAX_SAFE_INTEGER + 1);
  assertRejects(2 ** 53 + 1);
  assertRejects(1e23);
  assertRejects(Number.MAX_VALUE);
});

test("rejects NaN", () => {
  assertRejects(NaN);
});

test("rejects a value that is not a number", () => {
  assertRejects("45");
  assertRejects(null);
  assertRejects(undefined);
  assertRejects(true);
  assertRejects({});
  assertRejects([]);
  assertRejects(45n);
  assertRejects(new Number(45));
});
