import { assertOk, fetchWithRetry, PermanentError } from "./retry.ts";

export async function getYouTubeAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetchWithRetry(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
    { timeoutMs: 30_000 },
  );
  if (res.status === 400 || res.status === 401) {
    const detail = (await res.text()).slice(0, 200);
    throw new PermanentError(
      `YouTube sign-in was rejected (${res.status}). The refresh token may have expired or been revoked - generate a new one. ${detail}`,
    );
  }
  await assertOk(res, "YouTube sign-in");
  const json = await res.json();
  if (typeof json?.access_token !== "string") throw new Error("YouTube sign-in returned no access token");
  return json.access_token;
}

export async function uploadYouTubeVideo(
  accessToken: string,
  meta: { title: string; description: string; tags: string[]; privacy: string },
  bytes: Uint8Array,
): Promise<string> {
  const init = await fetchWithRetry(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(bytes.byteLength),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: "22" },
        status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
      }),
    },
    { timeoutMs: 30_000 },
  );
  await assertOk(init, "YouTube upload start");
  const location = init.headers.get("Location");
  if (!location) throw new Error("YouTube did not return an upload location");

  const upload = await fetchWithRetry(
    location,
    { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes },
    { retries: 1, timeoutMs: 120_000 },
  );
  await assertOk(upload, "YouTube video upload");
  const json = await upload.json();
  if (typeof json?.id !== "string") throw new Error("YouTube did not confirm the video upload");
  return json.id;
}

export async function setYouTubeThumbnail(
  accessToken: string,
  videoId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await fetchWithRetry(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=${encodeURIComponent(videoId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
      body: bytes,
    },
    { timeoutMs: 60_000 },
  );
  await assertOk(res, "YouTube thumbnail upload");
}
