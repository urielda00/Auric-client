const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getLocalGreeting,
} = require("../src/features/home/getLocalGreeting.cjs");

function localTime(hour, minute = 0) {
  return new Date(2026, 0, 1, hour, minute);
}

test("Home greeting follows device-local time boundaries", () => {
  assert.equal(getLocalGreeting(localTime(4, 59)), "Good night, Uriel.");
  assert.equal(getLocalGreeting(localTime(5)), "Good morning, Uriel.");
  assert.equal(getLocalGreeting(localTime(11, 59)), "Good morning, Uriel.");
  assert.equal(getLocalGreeting(localTime(12)), "Good afternoon, Uriel.");
  assert.equal(getLocalGreeting(localTime(13, 49)), "Good afternoon, Uriel.");
  assert.equal(getLocalGreeting(localTime(16, 59)), "Good afternoon, Uriel.");
  assert.equal(getLocalGreeting(localTime(17)), "Good evening, Uriel.");
  assert.equal(getLocalGreeting(localTime(21, 59)), "Good evening, Uriel.");
  assert.equal(getLocalGreeting(localTime(22)), "Good night, Uriel.");
});
