"use client";

import { useSyncExternalStore } from "react";

import { NORTHWIND_PRINCIPALS } from "@/lib/eval/northwind-principals";

const STORAGE_KEY = "useful-brain.assumed-principal";
const EVENT = "useful-brain:assumed-principal";

export function loadAssumedPrincipalKey(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && NORTHWIND_PRINCIPALS.some((principal) => principal.key === stored)
      ? stored
      : null;
  } catch {
    return null;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function useAssumedPrincipalKey(): string | null {
  return useSyncExternalStore(subscribe, loadAssumedPrincipalKey, () => null);
}

export function setAssumedPrincipalKey(key: string | null): void {
  try {
    if (key) {
      window.localStorage.setItem(STORAGE_KEY, key);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Without storage the selection cannot apply; the select re-reads it.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function assumedPrincipalFor(key: string | null) {
  const principal = NORTHWIND_PRINCIPALS.find((candidate) => candidate.key === key);
  return principal
    ? {
        userId: principal.userId,
        roles: principal.roles,
        departments: principal.departments,
      }
    : null;
}
