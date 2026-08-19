"use client";

import { useActionState, useRef, useState } from "react";
import { Camera, UserRound } from "lucide-react";
import { updateProfile, type ActionState } from "@/lib/actions/profile-actions";
import { REMOVE_AVATAR, UNCHANGED_AVATAR } from "@/lib/avatar";
import { SkillLevelPicker } from "@/components/skill-level-picker";

/**
 * The standing edit form for a member's own details.
 *
 * Distinct from `RegisterForm`, which is the gate before a first booking and so
 * ends in a redirect back to wherever the member was headed. This one is the
 * destination, so it stays put and confirms the save.
 */
export function ProfileForm({
  defaultName,
  defaultPhone,
  defaultSkillRating,
  defaultImage,
  email,
}: {
  defaultName: string;
  defaultPhone: string;
  defaultSkillRating: number | null;
  /** What is on file: an uploaded picture, the Google avatar the account
   *  arrived with, or empty. */
  defaultImage: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProfile, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <PicturePicker defaultImage={defaultImage} />

      <label className="text-sm font-bold text-foreground">
        Gmail
        <input
          value={email}
          disabled
          className="field mt-1 bg-secondary/50 text-muted-foreground w-full"
        />
        {/* Sign-in identity, so it isn't ours to edit — changing it would be
            changing which account this is. */}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          This is the account you sign in with, and how a doubles partner adds you to an entry.
        </span>
      </label>

      <label className="text-sm font-bold text-foreground">
        Complete name
        <input
          name="name"
          required
          minLength={2}
          defaultValue={defaultName}
          placeholder="Juan Dela Cruz"
          className="field mt-1 w-full"
        />
      </label>

      <label className="text-sm font-bold text-foreground">
        Mobile number
        <input
          name="phone"
          required
          defaultValue={defaultPhone}
          placeholder="09171234567"
          className="field mt-1 w-full"
        />
      </label>

      <SkillLevelPicker defaultValue={defaultSkillRating} />

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && !state.error && <p className="text-sm text-success">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary mt-2 self-start"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/**
 * The profile picture, chosen and cropped here rather than uploaded whole.
 *
 * The browser does the work: the file is centre-cropped square and re-encoded
 * to a 256px JPEG before it leaves the phone, which turns a 4MB camera photo
 * into about 20KB of data URL. That is small enough to live in the `image`
 * column beside the Google avatar it replaces, so there is no bucket to
 * provision, no signed upload, and nothing to clean up when a member changes
 * their mind. It is also the ceiling: a member who wants a 2000px portrait of
 * themselves is not the person this is for.
 */
function PicturePicker({ defaultImage }: { defaultImage: string }) {
  const [preview, setPreview] = useState(defaultImage);
  const [value, setValue] = useState<string>(UNCHANGED_AVATAR);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Picking the same file twice is a real thing people do after a failure.
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const data = await squareJpeg(file, 256);
      setPreview(data);
      setValue(data);
    } catch {
      setError("We couldn't read that file. A JPEG or PNG works best.");
    }
  }

  return (
    <div className="flex items-center gap-4">
      <input type="hidden" name="image" value={value} />
      <span className="relative shrink-0">
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a member's own
             upload is a data URL; there is nothing for the image loader to do. */
          <img
            src={preview}
            alt=""
            className="size-20 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-full bg-secondary text-muted-foreground ring-1 ring-border">
            <UserRound className="size-7" />
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
          <Camera className="size-3.5" />
        </span>
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-bold text-foreground">Profile picture</p>
        <p className="text-xs text-muted-foreground">
          Shown when you win a tournament. Square, and the middle is what we keep.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-sm btn-outline">
            {preview ? "Change picture" : "Add a picture"}
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => {
                setPreview("");
                setValue(REMOVE_AVATAR);
                setError(null);
              }}
              className="btn btn-sm btn-danger"
            >
              Remove
            </button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {value !== UNCHANGED_AVATAR && !error && (
          <p className="text-xs text-muted-foreground">Save changes to keep it.</p>
        )}
      </div>
    </div>
  );
}

/** Centre-cropped to a square and re-encoded, in the browser. */
async function squareJpeg(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}
