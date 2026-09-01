/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

const store = DataStore.createStore("BetterImageEditor", "library");

export type Kind = "avatar" | "banner";
export type Group = "original" | "cropped";

export interface CropState {
    zoomRatio: number;
    imageRotation: number;
    imageTransformCoordinates: { x: number; y: number; };
}

export interface Entry {
    id: string;
    name: string;
    kind: Kind;
    group: Group;
    sig: string;
    added: number;
    crop?: CropState;
}

const INDEX = "index";
const fileKey = (id: string) => `file:${id}`;
const thumbKey = (id: string) => `thumb:${id}`;

const THUMB_MAX = 160;

// entries saved before the cropped shelf existed carry no group, and they are all originals
export const readIndex = () => DataStore.get<Entry[]>(INDEX, store)
    .then(entries => (entries ?? []).map(entry => entry.group ? entry : { ...entry, group: "original" as Group }));
const writeIndex = (entries: Entry[]) => DataStore.set(INDEX, entries, store);

export const getFile = (id: string) => DataStore.get<Blob>(fileKey(id), store);
export const getThumbs = (ids: string[]) => DataStore.getMany<Blob>(ids.map(thumbKey), store);
export const clear = () => DataStore.clear(store);

export const cropOf = (state: any): CropState => ({
    zoomRatio: state.zoomRatio,
    imageRotation: state.imageRotation,
    imageTransformCoordinates: state.imageTransformCoordinates
});

// keeps the source aspect so the strip can crop it to a circle or a wide tile in CSS
function thumbnail(source: Blob) {
    return new Promise<Blob>((resolve, reject) => {
        const url = URL.createObjectURL(source);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);

            const scale = Math.min(1, THUMB_MAX / Math.max(image.width, image.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("could not draw a thumbnail")), "image/webp", 0.8);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("could not decode that image"));
        };

        image.src = url;
    });
}

export async function add(file: File, kind: Kind, group: Group, limit: number) {
    const sig = `${file.name}:${file.size}:${file.lastModified}`;
    const entries = await readIndex();
    const sameShelf = (entry: Entry) => entry.kind === kind && entry.group === group;

    const known = entries.find(entry => sameShelf(entry) && entry.sig === sig);
    if (known) return known.id;

    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const thumb = await thumbnail(file);

    await DataStore.set(fileKey(id), file, store);
    await DataStore.set(thumbKey(id), thumb, store);

    const next = [{ id, name: file.name, kind, group, sig, added: Date.now() }, ...entries];
    const dropped = next.filter(sameShelf).slice(limit);

    await writeIndex(next.filter(entry => !dropped.includes(entry)));
    for (const entry of dropped) await forgetBlobs(entry.id);

    return id;
}

async function forgetBlobs(id: string) {
    await DataStore.del(fileKey(id), store);
    await DataStore.del(thumbKey(id), store);
}

export async function forget(id: string) {
    await forgetBlobs(id);
    await writeIndex((await readIndex()).filter(entry => entry.id !== id));
}

export async function saveCrop(id: string, crop: CropState) {
    const entries = await readIndex();
    const entry = entries.find(entry => entry.id === id);
    if (!entry) return;

    entry.crop = crop;
    await writeIndex(entries);
}
