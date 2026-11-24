// Tests for the task logic in index.html (the <script id="gid-logic"> block).
// Run with: npm test   (or: node --test)
// The page stays one self-contained file, so the tests read that block out of index.html and run it.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script id="gid-logic">([\s\S]*?)<\/script>/);
if (!m) throw new Error('index.html has no <script id="gid-logic"> block');
vm.runInThisContext(m[1], { filename: "index.html (gid-logic)" });
const L = globalThis.GidLogic;

// Local times, so the tests behave the same in any time zone.
const at = (y, mo, d, hh = 12, mm = 0) => new Date(y, mo - 1, d, hh, mm);
const NOW = at(2026, 11, 24, 10, 0); // Tuesday 24 Nov 2026, 10:00

test("ymd formats a local date", () => {
  assert.equal(L.ymd(at(2026, 1, 5)), "2026-01-05");
  assert.equal(L.ymd(at(2026, 12, 31, 23, 59)), "2026-12-31");
});

test("dueDays counts whole days from today", () => {
  assert.equal(L.dueDays("2026-11-24", NOW), 0);
  assert.equal(L.dueDays("2026-11-25", NOW), 1);
  assert.equal(L.dueDays("2026-11-20", NOW), -4);
  assert.equal(L.dueDays("2026-12-01", NOW), 7);
  assert.equal(L.dueDays("2027-01-01", at(2026, 12, 31, 23, 59)), 1, "late in the day still counts tomorrow as 1");
});

test("dueDays ignores missing or malformed dates", () => {
  for (const bad of ["", null, undefined, "tomorrow", "2026-1-5", "24/11/2026"]) assert.equal(L.dueDays(bad, NOW), null);
});

test("dueText describes nearby dates", () => {
  assert.equal(L.dueText("2026-11-24", NOW), "Due today");
  assert.equal(L.dueText("2026-11-25", NOW), "Due tomorrow");
  assert.equal(L.dueText("2026-11-23", NOW), "Overdue by 1 day");
  assert.equal(L.dueText("2026-11-21", NOW), "Overdue by 3 days");
  assert.equal(L.dueText("", NOW), "");
  assert.match(L.dueText("2026-11-27", NOW), /^Due \S+/);
});

test("splitLines makes one task per line and drops list markers", () => {
  assert.deepEqual(L.splitLines("- buy milk\n\n* call mum\n1. pay rent\n2) book dentist\n• tidy desk\n   "),
    ["buy milk", "call mum", "pay rent", "book dentist", "tidy desk"]);
  assert.deepEqual(L.splitLines("\n\n"), []);
});

test("applySorterDates takes a written deadline over the automatic one", () => {
  const t = L.applySorterDates({ due: "2026-11-24", dueAuto: true }, { due: "2026-11-27", time: "15:00" });
  assert.equal(t.due, "2026-11-27");
  assert.equal(t.dueAuto, false);
  assert.equal(t.time, "15:00");
});

test("applySorterDates keeps a date the person set and rejects bad values", () => {
  const set = L.applySorterDates({ due: "2026-12-01", dueAuto: false, time: "09:00" }, { due: "2026-11-27", time: "15:00" });
  assert.equal(set.due, "2026-12-01");
  assert.equal(set.time, "09:00");
  const bad = L.applySorterDates({ due: "2026-11-24", dueAuto: true }, { due: "Friday", time: "3pm" });
  assert.equal(bad.due, "2026-11-24");
  assert.equal(bad.dueAuto, true);
  assert.equal(bad.time, undefined);
  for (const time of ["24:00", "7:30", "12:60"]) assert.equal(L.applySorterDates({}, { time }).time, undefined, time);
  assert.equal(L.applySorterDates({}, { time: "23:59" }).time, "23:59");
});

test("withDefaultDue makes old tasks due the day they were added", () => {
  const d = L.withDefaultDue({ created: at(2026, 11, 2, 18).getTime() });
  assert.equal(d.due, "2026-11-02");
  assert.equal(d.dueAuto, true);
  assert.deepEqual(L.withDefaultDue({ due: "2026-11-05", created: 1 }), { due: "2026-11-05", created: 1 });
});

const task = (num, extra) => ({ id: "t" + num, num, status: "queued", ...extra });
const nextId = (list, busy, now = NOW) => (L.pickNext(list, busy, now) || {}).id;

test("Up next: soonest day wins", () => {
  assert.equal(nextId([task(1, { due: "2026-11-25" }), task(2, { due: "2026-11-24" })]), "t2");
  assert.equal(nextId([task(1, { due: "2026-11-24" }), task(2, { due: "2026-11-20" })]), "t2", "overdue comes first");
});

test("Up next: on the same day, timed tasks lead, earliest first", () => {
  const list = [task(1, { due: "2026-11-24", status: "needs_ok" }), task(2, { due: "2026-11-24", time: "16:00" }), task(3, { due: "2026-11-24", time: "09:00" })];
  assert.equal(nextId(list), "t3", "a passed time stays up next until it's done");
});

test("Up next: times only matter for today and tomorrow", () => {
  const list = [task(1, { due: "2026-11-30", time: "08:00" }), task(2, { due: "2026-11-30", status: "needs_ok" })];
  assert.equal(nextId(list), "t2");
});

test("Up next: then what needs you most, then arrow order, then the oldest task", () => {
  const day = { due: "2026-11-24" };
  assert.equal(nextId([task(1, { ...day, status: "done" }), task(2, { ...day, status: "flagged" }), task(3, { ...day, status: "needs_ok" })]), "t3");
  assert.equal(nextId([task(1, { ...day, order: 20 }), task(2, { ...day, order: 10 })]), "t2");
  assert.equal(nextId([task(1, { ...day, order: 10 }), task(2, day)]), "t1", "a moved task beats an unmoved one");
  assert.equal(nextId([task(5, day), task(3, day)]), "t3");
});

test("Up next: tasks without a date come after dated ones", () => {
  assert.equal(nextId([task(1, {}), task(2, { due: "2026-12-20" })]), "t2");
});

test("Up next skips complete, in-progress and busy tasks", () => {
  const list = [task(1, { status: "complete" }), task(2, { status: "doing" }), task(3, { status: "inbox" }), task(4, {})];
  assert.equal(nextId(list), "t4");
  assert.equal(L.pickNext(list, new Set(["t4"]), NOW), null);
  assert.equal(L.pickNext([], null, NOW), null);
});

test("periodStart finds the start of the day, week (Monday), month and year", () => {
  assert.equal(L.ymd(L.periodStart("day", NOW)), "2026-11-24");
  assert.equal(L.ymd(L.periodStart("week", NOW)), "2026-11-23");
  assert.equal(L.ymd(L.periodStart("week", at(2026, 11, 29))), "2026-11-23", "Sunday belongs to the week that started Monday");
  assert.equal(L.ymd(L.periodStart("month", NOW)), "2026-11-01");
  assert.equal(L.ymd(L.periodStart("year", NOW)), "2026-01-01");
  assert.equal(L.periodStart("day", NOW).getHours(), 0);
});

test("rollover: an unfinished task from an earlier day belongs to today", () => {
  const nowTs = NOW.getTime(), start = L.periodStart("day", NOW).getTime();
  const old = task(1, { status: "your_turn", created: at(2026, 11, 10).getTime() });
  assert.equal(L.dayOf(old, nowTs), nowTs);
  const { all, done } = L.historySets([old], start, nowTs);
  assert.deepEqual(all.map(t => t.id), ["t1"]);
  assert.deepEqual(done, []);
});

test("rollover: a finished task stays on the day it was completed", () => {
  const nowTs = NOW.getTime(), today = L.periodStart("day", NOW).getTime();
  const doneYesterday = task(1, { status: "complete", created: at(2026, 11, 20).getTime(), completedAt: at(2026, 11, 23, 17).getTime() });
  const doneToday = task(2, { status: "complete", created: at(2026, 11, 20).getTime(), completedAt: at(2026, 11, 24, 9).getTime() });
  const doneEarlier = task(3, { status: "complete", completedAt: at(2026, 11, 24, 8).getTime() });
  assert.equal(L.dayOf(doneYesterday, nowTs), doneYesterday.completedAt);
  const day = L.historySets([doneYesterday, doneEarlier, doneToday], today, nowTs);
  assert.deepEqual(day.done.map(t => t.id), ["t2", "t3"], "newest first");
  assert.deepEqual(day.all.map(t => t.id), ["t3", "t2"]);
  const week = L.historySets([doneYesterday, doneToday], L.periodStart("week", NOW).getTime(), nowTs);
  assert.equal(week.done.length, 2);
});

test("doneTime falls back from completedAt to finishedAt to created", () => {
  assert.equal(L.doneTime({ completedAt: 3, finishedAt: 2, created: 1 }), 3);
  assert.equal(L.doneTime({ finishedAt: 2, created: 1 }), 2);
  assert.equal(L.doneTime({ created: 1 }), 1);
  assert.equal(L.doneTime({}), 0);
});
