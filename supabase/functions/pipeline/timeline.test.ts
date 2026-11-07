import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, splitIntoVisualBeats } from "./timeline.ts";

test("visual beats preserve parent named subjects and exact search queries", () => {
  const [segment] = buildTimeline([{
    label: "Film awards",
    narration: "He won three major awards. Later, the film became a huge success with audiences.",
    camera_angle: "medium",
    broll: "Dhanush film award ceremony",
    on_screen_text: "Major awards",
    search_queries: ["Dhanush award ceremony", "Dhanush film event"],
    subject_keywords: ["dhanush", "award"],
  }]);
  const beats = splitIntoVisualBeats(segment);
  assert.ok(beats.length >= 2);
  for (const beat of beats) {
    assert.ok(beat.segment.broll.includes("dhanush"));
    assert.deepEqual(beat.segment.search_queries, ["Dhanush award ceremony", "Dhanush film event"]);
    assert.ok(beat.segment.subject_keywords?.includes("dhanush"));
  }
});

test("visual beats remain within the parent scene timeline", () => {
  const [segment] = buildTimeline([{
    label: "Investing",
    narration: "Monthly investment plans help people invest consistently and build wealth over a long period.",
    camera_angle: "wide",
    broll: "monthly investment contribution",
    on_screen_text: null,
  }]);
  const beats = splitIntoVisualBeats(segment);
  assert.equal(beats[0].offset_sec, 0);
  assert.ok(Math.abs(beats.reduce((sum, beat) => sum + beat.duration_sec, 0) - (segment.end_sec - segment.start_sec)) < 0.11);
  assert.ok(beats.every((beat) => beat.duration_sec > 0));
});
