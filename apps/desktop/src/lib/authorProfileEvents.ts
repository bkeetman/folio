import type { AuthorProfile } from "../types/library";

export const AUTHOR_PROFILE_UPDATED_EVENT = "folio:author-profile-updated";

export type AuthorProfileUpdatedDetail = {
  profile: AuthorProfile;
};

export function emitAuthorProfileUpdated(profile: AuthorProfile): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuthorProfileUpdatedDetail>(AUTHOR_PROFILE_UPDATED_EVENT, {
      detail: { profile },
    })
  );
}
