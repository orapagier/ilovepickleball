"use client";

import { useActionState, useState } from "react";
import { CalendarPlus, Lock, Trash2, Trophy } from "lucide-react";
import type { TournamentFormat, TournamentPlayType, TournamentStatus } from "@/generated/prisma/enums";
import { saveTournament, type ActionState } from "@/lib/actions/tournament-actions";
import {
  defaultPoolCount,
  defaultSwissRounds,
  EDITABLE_BY_STATUS,
  FORMAT_BLURBS,
  FORMAT_LABELS,
  MAX_ROUND_ROBIN_ENTRIES,
  maxSwissRounds,
  placeLabel,
  PLAY_TYPE_LABELS,
  totalMatchCount,
} from "@/lib/tournament";
import type { EditableField } from "@/lib/tournament";
import { formatSkillBand, SKILL_RATINGS } from "@/lib/skill";
import { cn } from "@/lib/utils";

export type TournamentFormValues = {
  id?: string;
  name: string;
  description: string;
  format: TournamentFormat;
  playType: TournamentPlayType;
  /** Empty string means that side is open-ended; both empty means all levels. */
  minSkillRating: string;
  maxSkillRating: string;
  maxEntries: number;
  minEntries: number;
  /** In whole currency units — cents are the storage detail, not the input. */
  entryFee: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startAt: string;
  courtIds: number[];
  prizeDescription: string;
  /** One row per place awarded. `amount` is in whole currency units and empty
   *  means the prize isn't money. */
  prizes: { place: number; label: string; amount: string; description: string }[];
  /** Empty string means "inherit the facility default". */
  averageMatchMinutes: string;
  courtChangeoverMinutes: string;
  /** Empty string means "let the format pick for this field size". */
  poolCount: string;
  advancePerPool: string;
  swissRounds: string;
};

const INPUT = "field w-full read-only:bg-secondary/50 read-only:text-muted-foreground";

/**
 * Create and edit in one form. Which fields it lets an admin touch comes
 * straight from `EDITABLE_BY_STATUS`, so the form and the action that rejects a
 * forbidden change are reading the same table rather than two copies of it.
 *
 * A locked field still submits its current value — as a hidden input where the
 * control can't be made read-only — so re-saving an in-flight tournament isn't
 * read by the server as an attempt to change what's locked.
 */
export function TournamentForm({
  initial,
  courts,
  status,
  currency,
  defaultPacing,
}: {
  initial: TournamentFormValues;
  courts: { id: number; name: string }[];
  /** `draft` for a new tournament — everything is editable until it's published. */
  status: TournamentStatus;
  currency: string;
  /** The facility figures a blank override falls back to. */
  defaultPacing: { matchMinutes: number; changeoverMinutes: number };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveTournament, {});
  const [format, setFormat] = useState<TournamentFormat>(initial.format);
  const [courtIds, setCourtIds] = useState<number[]>(initial.courtIds);
  const [maxEntries, setMaxEntries] = useState<number>(initial.maxEntries);

  const editable = EDITABLE_BY_STATUS[status];
  const can = (field: EditableField) => editable.includes(field);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Section title="What it is">
        <Field label="Name" locked={!can("name")}>
          <input name="name" defaultValue={initial.name} required readOnly={!can("name")} className={INPUT} />
        </Field>

        <Field label="Description" locked={!can("description")}>
          <textarea
            name="description"
            defaultValue={initial.description}
            rows={3}
            readOnly={!can("description")}
            className={INPUT}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Format" locked={!can("format")}>
            {can("format") ? (
              <select
                name="format"
                value={format}
                onChange={(e) => setFormat(e.target.value as TournamentFormat)}
                className={INPUT}
              >
                {(Object.keys(FORMAT_LABELS) as TournamentFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            ) : (
              <LockedValue name="format" value={initial.format} display={FORMAT_LABELS[initial.format]} />
            )}
            <p className="mt-1 text-xs text-muted-foreground">{FORMAT_BLURBS[format]}</p>
          </Field>

          <Field label="Play type" locked={!can("playType")}>
            {can("playType") ? (
              <select name="playType" defaultValue={initial.playType} className={INPUT}>
                {(Object.keys(PLAY_TYPE_LABELS) as TournamentPlayType[]).map((p) => (
                  <option key={p} value={p}>
                    {PLAY_TYPE_LABELS[p]}
                  </option>
                ))}
              </select>
            ) : (
              <LockedValue name="playType" value={initial.playType} display={PLAY_TYPE_LABELS[initial.playType]} />
            )}
          </Field>
        </div>

        <SkillBandField
          min={initial.minSkillRating}
          max={initial.maxSkillRating}
          locked={!can("skillBand")}
        />
      </Section>

      <Section title="Entries">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Maximum entries" locked={!can("maxEntries")}>
            <input
              name="maxEntries"
              type="number"
              min={2}
              defaultValue={initial.maxEntries}
              required
              readOnly={!can("maxEntries")}
              onChange={(e) => setMaxEntries(Number(e.target.value) || 0)}
              className={INPUT}
            />
          </Field>
          <Field label="Minimum entries" hint="Below this at close, it auto-cancels." locked={!can("minEntries")}>
            <input
              name="minEntries"
              type="number"
              min={2}
              defaultValue={initial.minEntries}
              required
              readOnly={!can("minEntries")}
              className={INPUT}
            />
          </Field>
          <Field label={`Entry fee (${currency})`} locked={!can("entryFeeCents")}>
            <input
              name="entryFee"
              type="number"
              min={0}
              step="0.01"
              defaultValue={initial.entryFee}
              readOnly={!can("entryFeeCents")}
              className={INPUT}
            />
          </Field>
        </div>

        {format === "round_robin" && (
          <p className="rounded-2xl bg-secondary/60 p-4 text-xs text-muted-foreground">
            A round robin plays every pair, so {MAX_ROUND_ROBIN_ENTRIES} entries is already{" "}
            {(MAX_ROUND_ROBIN_ENTRIES * (MAX_ROUND_ROBIN_ENTRIES - 1)) / 2} matches through two courts — the cap for
            this format.
          </p>
        )}

        {/* The shape knobs, shown only for the format that reads them. Blank
            means the format picks something sensible for the field size, so an
            admin never has to have an opinion here. */}
        {format === "pool_to_bracket" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Pools"
              hint={`Blank splits ${maxEntries || "the field"} into ${defaultPoolCount(maxEntries || 2)}.`}
              locked={!can("formatShape")}
            >
              <input
                name="poolCount"
                type="number"
                min={1}
                placeholder={String(defaultPoolCount(maxEntries || 2))}
                defaultValue={initial.poolCount}
                readOnly={!can("formatShape")}
                className={INPUT}
              />
            </Field>
            <Field label="Advance per pool" hint="Blank takes the top two out of each." locked={!can("formatShape")}>
              <input
                name="advancePerPool"
                type="number"
                min={1}
                placeholder="2"
                defaultValue={initial.advancePerPool}
                readOnly={!can("formatShape")}
                className={INPUT}
              />
            </Field>
          </div>
        )}

        {format === "swiss" && (
          <Field
            label="Rounds"
            hint={`Blank plays ${defaultSwissRounds(maxEntries || 2)} — enough to separate a field this size. At most ${maxSwissRounds(maxEntries || 2)}, past which a pairing would have to repeat.`}
            locked={!can("formatShape")}
          >
            <input
              name="swissRounds"
              type="number"
              min={1}
              max={maxSwissRounds(maxEntries || 2)}
              placeholder={String(defaultSwissRounds(maxEntries || 2))}
              defaultValue={initial.swissRounds}
              readOnly={!can("formatShape")}
              className={INPUT}
            />
          </Field>
        )}

        {maxEntries >= 2 && (
          <p className="text-xs text-muted-foreground">
            A full field of {maxEntries} plays about {totalMatchCount(format, maxEntries)} matches in this format.
          </p>
        )}
      </Section>

      <Section title="When">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Registration opens"
            hint="Blank means entries open the moment you publish. Set a date and members can see the tournament but not enter until then."
            locked={!can("registrationOpensAt")}
          >
            <input
              name="registrationOpensAt"
              type="datetime-local"
              defaultValue={initial.registrationOpensAt}
              readOnly={!can("registrationOpensAt")}
              className={INPUT}
            />
          </Field>
          <Field label="Registration closes" locked={!can("registrationClosesAt")}>
            <input
              name="registrationClosesAt"
              type="datetime-local"
              defaultValue={initial.registrationClosesAt}
              required
              readOnly={!can("registrationClosesAt")}
              className={INPUT}
            />
          </Field>
          <Field label="Play starts" locked={!can("startAt")}>
            <input
              name="startAt"
              type="datetime-local"
              defaultValue={initial.startAt}
              required
              readOnly={!can("startAt")}
              className={INPUT}
            />
          </Field>
        </div>

        {/* Only while creating. Once the tournament exists its schedule is a
            live thing — windows hold matches, and removing one unschedules
            them — so it moves to the ScheduleEditor on the tournament's own
            page, which edits them one at a time against real consequences. */}
        {!initial.id && <NewWindowsField />}
      </Section>

      <Section title="Courts, pacing and prizes">
        <Field label="Courts held" hint="These are blocked on the booking calendar." locked={!can("courtIds")}>
          <div className="flex flex-wrap gap-2">
            {courts.map((court) => {
              const checked = courtIds.includes(court.id);
              return (
                <label
                  key={court.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    checked ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground",
                    !can("courtIds") && "cursor-not-allowed opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    name="courtIds"
                    value={court.id}
                    checked={checked}
                    disabled={!can("courtIds")}
                    onChange={(e) =>
                      setCourtIds((ids) =>
                        e.target.checked ? [...ids, court.id] : ids.filter((cid) => cid !== court.id),
                      )
                    }
                    className="size-4 accent-current"
                  />
                  {court.name}
                </label>
              );
            })}
          </div>
          {/* A disabled checkbox posts nothing, so the locked case re-submits
              the current courts by hand — otherwise saving would read as
              "clear the court list". */}
          {!can("courtIds") &&
            initial.courtIds.map((cid) => <input key={cid} type="hidden" name="courtIds" value={cid} />)}
        </Field>

        {/* These only resize the court block — the running order is always the
            live queue — so they stay editable later than the structural
            fields do. Blank inherits the facility default. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Match length (minutes)"
            hint={`Blank uses the facility default of ${defaultPacing.matchMinutes} min.`}
            locked={!can("pacing")}
          >
            <input
              name="averageMatchMinutes"
              type="number"
              min={1}
              placeholder={String(defaultPacing.matchMinutes)}
              defaultValue={initial.averageMatchMinutes}
              readOnly={!can("pacing")}
              className={INPUT}
            />
          </Field>
          <Field
            label="Court changeover (minutes)"
            hint={`Blank uses the facility default of ${defaultPacing.changeoverMinutes} min.`}
            locked={!can("pacing")}
          >
            <input
              name="courtChangeoverMinutes"
              type="number"
              min={0}
              placeholder={String(defaultPacing.changeoverMinutes)}
              defaultValue={initial.courtChangeoverMinutes}
              readOnly={!can("pacing")}
              className={INPUT}
            />
          </Field>
        </div>

        <PrizesField initial={initial.prizes} currency={currency} locked={!can("prizes")} />

        <Field
          label="Extra prize notes"
          hint="Anything that doesn't belong to one placing — trophies for every finalist, a raffle, where to collect."
          locked={!can("prizeDescription")}
        >
          <textarea
            name="prizeDescription"
            defaultValue={initial.prizeDescription}
            rows={2}
            readOnly={!can("prizeDescription")}
            className={INPUT}
          />
        </Field>
      </Section>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-success">{state.message}</p>}

      <button
        type="submit"
        disabled={pending || editable.length === 0}
        className="btn btn-primary self-start"
      >
        {pending ? "Saving…" : initial.id ? "Save changes" : "Create draft"}
      </button>

      {editable.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing on this tournament can be edited any more — its configuration is locked at this stage.
        </p>
      )}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="surface-card flex flex-col gap-4 p-4 sm:p-5">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {label}
        {locked && <Lock className="size-3 opacity-70" aria-label="Locked at this stage" />}
      </span>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Windows of play, set while the tournament is being created.
 *
 * They belong here because a tournament that spans several mornings is that
 * shape from the moment it is conceived, not after it is published — an admin
 * who has to save first and schedule second has to remember to come back, and
 * the window they meant is the one detail most likely to be forgotten.
 *
 * Rows post as parallel `sessionName`/`sessionStartAt`/`sessionEndAt` fields,
 * read back with `getAll` in index order. Adding none is the normal case and
 * means what it always meant: one continuous block from the start time.
 */
function NewWindowsField() {
  type Row = { key: number; name: string; startAt: string; endAt: string };
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const add = () => {
    setRows((r) => [...r, { key: nextKey, name: `Round ${r.length + 1}`, startAt: "", endAt: "" }]);
    setNextKey((k) => k + 1);
  };
  const update = (key: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => setRows((r) => r.filter((row) => row.key !== key));

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Windows of play</p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No windows: play runs as one continuous block from the start time, and the courts are held for as long as
          the draw is estimated to take. Add windows to spread it across mornings or days instead — you can also do
          this later, and assign rounds to them once the draw exists.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Which round plays in which window is set after the draw is made, on the tournament&rsquo;s own page.
        </p>
      )}

      {rows.map((row) => (
        <div key={row.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="text-xs font-medium text-muted-foreground">
            Name
            <input
              name="sessionName"
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value })}
              required
              maxLength={60}
              placeholder="Round 1"
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Starts
            <input
              name="sessionStartAt"
              type="datetime-local"
              value={row.startAt}
              onChange={(e) => update(row.key, { startAt: e.target.value })}
              required
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Ends
            <input
              name="sessionEndAt"
              type="datetime-local"
              value={row.endAt}
              onChange={(e) => update(row.key, { endAt: e.target.value })}
              required
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <button
            type="button"
            onClick={() => remove(row.key)}
            className="btn btn-danger btn-sm"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <CalendarPlus className="size-4" />
        Add a window
      </button>
    </div>
  );
}

/**
 * The prize table, one row per place.
 *
 * Per place rather than one box of prose because a placing is a thing the draw
 * produces: `finalPlacements` works out who finished third, and this is what
 * says what third is worth, so the results page can put the two together. A
 * single paragraph could only ever be printed *next* to the results.
 *
 * Rows post as parallel `prizePlace` / `prizeLabel` / `prizeAmount` /
 * `prizeNote` fields, read back with `getAll` in index order — the same shape
 * the windows-of-play rows use, for the same reason: a repeating group is not
 * worth a JSON blob in a hidden input.
 *
 * Locked, the rows are plain text plus hidden inputs carrying exactly what is
 * already stored, so re-saving a tournament whose prizes are locked isn't read
 * by the server as an attempt to change them.
 */
function PrizesField({
  initial,
  currency,
  locked,
}: {
  initial: TournamentFormValues["prizes"];
  currency: string;
  locked: boolean;
}) {
  type Row = { key: number; place: string; label: string; amount: string; description: string };
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((p, i) => ({
      key: i,
      place: String(p.place),
      label: p.label,
      amount: p.amount,
      description: p.description,
    })),
  );
  const [nextKey, setNextKey] = useState(initial.length);

  const add = () => {
    // The next place down, which is what an admin filling this in is almost
    // always reaching for.
    const used = rows.map((r) => Number(r.place)).filter((n) => Number.isInteger(n));
    const place = String(Math.max(0, ...used) + 1);
    setRows((r) => [...r, { key: nextKey, place, label: defaultPrizeLabel(Number(place)), amount: "", description: "" }]);
    setNextKey((k) => k + 1);
  };
  const update = (key: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => setRows((r) => r.filter((row) => row.key !== key));

  if (locked) {
    return (
      <Field label="Prizes" locked>
        {initial.map((p) => (
          <span key={p.place}>
            <input type="hidden" name="prizePlace" value={p.place} />
            <input type="hidden" name="prizeLabel" value={p.label} />
            <input type="hidden" name="prizeAmount" value={p.amount} />
            <input type="hidden" name="prizeNote" value={p.description} />
          </span>
        ))}
        <p className="field bg-secondary/50 text-muted-foreground w-full">
          {initial.length === 0
            ? "No prizes set."
            : initial
                .map((p) => `${p.label}${p.amount ? ` — ${currency} ${p.amount}` : ""}`)
                .join(" · ")}
        </p>
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">Prizes</span>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No prizes named. Add one per placing — the results page pairs each with whoever finishes there.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Place 1 is the champion, 2 the runner-up. Leave the amount blank for a prize that isn&rsquo;t money.
        </p>
      )}

      {rows.map((row) => (
        <div key={row.key} className="grid gap-2 sm:grid-cols-[5rem_1fr_7rem_1fr_auto] sm:items-end">
          <label className="text-xs font-medium text-muted-foreground">
            Place
            <input
              name="prizePlace"
              type="number"
              min={1}
              value={row.place}
              onChange={(e) => update(row.key, { place: e.target.value })}
              required
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Called
            <input
              name="prizeLabel"
              value={row.label}
              onChange={(e) => update(row.key, { label: e.target.value })}
              maxLength={60}
              placeholder={defaultPrizeLabel(Number(row.place))}
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Cash ({currency})
            <input
              name="prizeAmount"
              type="number"
              min={0}
              step="0.01"
              value={row.amount}
              onChange={(e) => update(row.key, { amount: e.target.value })}
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Also wins
            <input
              name="prizeNote"
              value={row.description}
              onChange={(e) => update(row.key, { description: e.target.value })}
              maxLength={200}
              placeholder="Trophy, paddle…"
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <button
            type="button"
            onClick={() => remove(row.key)}
            aria-label={`Remove the prize for place ${row.place}`}
            className="btn btn-danger btn-sm"
          >
            <Trash2 className="size-3.5" />
            <span className="sm:hidden">Remove</span>
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <Trophy className="size-4" />
        Add a prize
      </button>
    </div>
  );
}

/** Mirrors `placeLabel` on the server so the placeholder an admin sees is the
 *  label the server would fall back to if they leave it blank. */
function defaultPrizeLabel(place: number): string {
  return Number.isInteger(place) && place > 0 ? placeLabel(place) : "";
}

/**
 * The entry rule, as the two bounds that are actually enforced. There is no
 * separate label to keep in step: what an admin sees here is `formatSkillBand`,
 * the same string the browse card and the tournament page show, so a band can
 * never read as one thing and admit another.
 */
function SkillBandField({ min, max, locked }: { min: string; max: string; locked: boolean }) {
  const [lo, setLo] = useState(min);
  const [hi, setHi] = useState(max);
  const band = formatSkillBand(lo === "" ? null : Number(lo), hi === "" ? null : Number(hi));

  if (locked) {
    return (
      <Field label="Skill level" locked>
        <input type="hidden" name="minSkillRating" value={min} />
        <input type="hidden" name="maxSkillRating" value={max} />
        <p className="field bg-secondary/50 text-muted-foreground w-full">
          {formatSkillBand(min === "" ? null : Number(min), max === "" ? null : Number(max))}
        </p>
      </Field>
    );
  }

  return (
    <Field
      label="Skill level"
      hint={`Only members rated inside this band can enter. Leave both blank for all levels. Currently: ${band}.`}
    >
      <div className="flex items-center gap-2">
        <select name="minSkillRating" value={lo} onChange={(e) => setLo(e.target.value)} className={INPUT}>
          <option value="">No minimum</option>
          {SKILL_RATINGS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.blurb}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-sm text-muted-foreground">to</span>
        <select name="maxSkillRating" value={hi} onChange={(e) => setHi(e.target.value)} className={INPUT}>
          <option value="">No maximum</option>
          {SKILL_RATINGS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.blurb}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

function LockedValue({ name, value, display }: { name: string; value: string; display: string }) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <p className="field bg-secondary/50 text-muted-foreground w-full">
        {display}
      </p>
    </>
  );
}
