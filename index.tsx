/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { DeleteIcon } from "@components/Icons";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Alerts, Button, Constants, FluxDispatcher, React, ReactDOM, RestAPI, useCallback, useEffect, useRef, useState, UserStore, useStateFromStores } from "@webpack/common";

import { add, clear, cropOf, CropState, Entry, forget, getFile, getThumbs, Group, Kind, readIndex, saveCrop } from "./library";

interface RecentAvatar {
    id: string;
    description: string;
    storageHash: string;
}

interface Picked {
    id: string;
    uri: string;
    file: File;
}

const RecentAvatarsStore = findStoreLazy("RecentAvatarsStore");
const logger = new Logger("BetterImageEditor");

const settings = definePluginSettings({
    librarySize: {
        type: OptionType.SLIDER,
        description: "How many pictures to keep on each shelf",
        markers: [6, 12, 24, 48],
        default: 24,
        stickToMarkers: true
    },
    rememberCrop: {
        type: OptionType.BOOLEAN,
        description: "Restore the zoom and position you last used for a picture",
        default: true
    },
    saveCropped: {
        type: OptionType.BOOLEAN,
        description: "Keep a copy of each picture after you crop it",
        default: true
    },
    askBeforeSavingCropped: {
        type: OptionType.BOOLEAN,
        description: "Ask first, instead of keeping the cropped copy automatically",
        default: false
    },
    showDiscordRecents: {
        type: OptionType.BOOLEAN,
        description: "Show Discord's own recent avatars on the cropped shelf in the editor",
        default: true
    },
    clearLibrary: {
        type: OptionType.COMPONENT,
        description: "Throw away every picture you have saved",
        component: () => (
            <Button
                color={Button.Colors.PRIMARY}
                onClick={() => Alerts.show({
                    title: "Clear saved pictures?",
                    body: <p>Every picture you have saved here goes, along with the crop remembered for each one. Discord's own archive and your current avatar and banner are not touched.</p>,
                    confirmColor: Button.Colors.RED,
                    confirmText: "Clear",
                    cancelText: "Cancel",
                    onConfirm: () => clear().catch(err => logger.error("could not clear the library", err))
                })}
            >
                Clear saved pictures
            </Button>
        )
    }
});

// the cropper keeps its crop in a useReducer we cannot reach from outside, so the patch
// hands it through these two. handoff marks a picture the picker already dealt with, so
// the editor does not file a second copy of it.
let pendingCrop: CropState | null = null;
let liveCrop: any = null;
let handoff: { id: string | null; } | null = null;

const spied = new WeakMap<Function, Function>();

const kindOf = (uploadType: string): Kind => uploadType === "BANNER" ? "banner" : "avatar";

const croppedLabel = (kind: Kind) => kind === "banner" ? "Cropped banners" : "Cropped avatars";

function recentUrl(avatar: RecentAvatar, userId: string, size: number) {
    return `https://cdn.discordapp.com/avatars/${userId}/archived/${avatar.id}/${avatar.storageHash}.webp?size=${size}`;
}

async function toFile(url: string, name: string, type = "image/webp") {
    const blob = await fetch(url).then(r => r.blob());
    return new File([blob], name, { type: blob.type || type });
}

function useLibrary(kind: Kind) {
    const [group, setGroup] = useState<Group>("original");
    const [version, setVersion] = useState(0);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});

    const urls = useRef<string[]>([]);
    const bump = useCallback(() => setVersion(v => v + 1), []);
    const track = useCallback((url: string) => { urls.current.push(url); return url; }, []);

    useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);

    useEffect(() => {
        let live = true;

        (async () => {
            const mine = (await readIndex()).filter(entry => entry.kind === kind && entry.group === group);
            const blobs = await getThumbs(mine.map(entry => entry.id));
            if (!live) return;

            const next: Record<string, string> = {};
            mine.forEach((entry, index) => {
                const blob = blobs[index];
                if (blob) next[entry.id] = track(URL.createObjectURL(blob));
            });

            setThumbs(next);
            setEntries(mine);
        })();

        return () => { live = false; };
    }, [kind, group, version]);

    return { group, setGroup, entries, thumbs, bump, track };
}

function useForget(bump: () => void) {
    return useCallback((entry: Entry, immediate: boolean) => {
        const run = () => forget(entry.id)
            .then(bump)
            .catch(err => logger.error("could not remove that picture", err));

        if (immediate) return void run();

        Alerts.show({
            title: "Remove this picture?",
            body: <p>{entry.name} goes from your saved pictures, along with the crop remembered for it.</p>,
            confirmColor: Button.Colors.RED,
            confirmText: "Remove",
            cancelText: "Cancel",
            onConfirm: run
        });
    }, [bump]);
}

// the picker stays mounted under the cropper, so both surfaces listen at once. the
// cropper is always the one on top, and takes the paste.
let editorsOpen = 0;

function usePasteAndDrop(accept: (file: File) => void, active: () => boolean) {
    useEffect(() => {
        const imageIn = (list: FileList | undefined) =>
            [...(list ?? [])].find(file => file.type.startsWith("image/"));

        const take = (file: File | undefined, event: Event) => {
            if (!file || !active()) return;
            event.preventDefault();
            event.stopPropagation();
            accept(file);
        };

        const onPaste = (event: ClipboardEvent) => take(imageIn(event.clipboardData?.files), event);
        const onDrop = (event: DragEvent) => take(imageIn(event.dataTransfer?.files), event);
        const onDragOver = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
        };

        document.addEventListener("paste", onPaste, true);
        document.addEventListener("drop", onDrop, true);
        document.addEventListener("dragover", onDragOver, true);

        return () => {
            document.removeEventListener("paste", onPaste, true);
            document.removeEventListener("drop", onDrop, true);
            document.removeEventListener("dragover", onDragOver, true);
        };
    }, [accept, active]);
}

function Shelf({ kind, group, entries, thumbs, activeId, withRecents, onGroup, onPick, onForget, onPickRecent, onDeleteRecent }: {
    kind: Kind;
    group: Group;
    entries: Entry[];
    thumbs: Record<string, string>;
    activeId: string | null;
    withRecents: boolean;
    onGroup(group: Group): void;
    onPick(entry: Entry): void;
    onForget(entry: Entry, immediate: boolean): void;
    onPickRecent?(avatar: RecentAvatar): void;
    onDeleteRecent?(avatar: RecentAvatar): void;
}) {
    const recents: RecentAvatar[] = useStateFromStores([RecentAvatarsStore], () => RecentAvatarsStore.getAvatars());
    const user = UserStore.getCurrentUser();
    const showRecents = withRecents && kind === "avatar" && group === "cropped"
        && settings.use(["showDiscordRecents"]).showDiscordRecents && user && recents?.length;

    return (
        <div className={`bie-panel bie-${kind}`}>
            <div className="bie-tabs" role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={group === "original"}
                    className={`bie-tab${group === "original" ? " bie-on" : ""}`}
                    onClick={() => onGroup("original")}
                >Originals</button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={group === "cropped"}
                    className={`bie-tab${group === "cropped" ? " bie-on" : ""}`}
                    onClick={() => onGroup("cropped")}
                >{croppedLabel(kind)}</button>
            </div>

            <div className="bie-strip" role="group" aria-label="Saved pictures">
                {entries.map(entry => (
                    <div key={entry.id} className="bie-item">
                        <button
                            type="button"
                            aria-label={entry.name}
                            title={entry.name}
                            className={`bie-thumb${activeId === entry.id ? " bie-active" : ""}`}
                            style={{ backgroundImage: `url(${thumbs[entry.id]})` }}
                            onClick={() => onPick(entry)}
                            onContextMenu={event => {
                                event.preventDefault();
                                onForget(entry, event.shiftKey);
                            }}
                        />
                        <button
                            type="button"
                            className="bie-remove"
                            aria-label={`Remove ${entry.name}`}
                            title="Remove. Hold Shift to skip the confirmation"
                            onClick={event => onForget(entry, event.shiftKey)}
                        >
                            <DeleteIcon width={10} height={10} />
                        </button>
                    </div>
                ))}

                {entries.length > 0 && showRecents && <div className="bie-divider" />}

                {showRecents && recents.map(avatar => (
                    <div key={avatar.id} className="bie-item">
                        <button
                            type="button"
                            aria-label={avatar.description}
                            title={`${avatar.description}\nFrom Discord's archive`}
                            className={`bie-thumb bie-archived${activeId === avatar.id ? " bie-active" : ""}`}
                            style={{ backgroundImage: `url(${recentUrl(avatar, user!.id, 80)})` }}
                            onClick={() => onPickRecent?.(avatar)}
                        />
                        <button
                            type="button"
                            className="bie-remove"
                            aria-label={`Delete ${avatar.description} from Discord`}
                            title="Delete from Discord's archive. This cannot be undone"
                            onClick={() => onDeleteRecent?.(avatar)}
                        >
                            <DeleteIcon width={10} height={10} />
                        </button>
                    </div>
                ))}

                {!entries.length && !showRecents && (
                    <span className="bie-empty">
                        {group === "original"
                            ? "Pictures you pick, paste or drop land here"
                            : "Pictures you crop land here"}
                    </span>
                )}
            </div>
        </div>
    );
}

// this one leaves the client: it removes the avatar from Discord's own archive, so it
// always asks, Shift or not.
function askToDeleteRecent(avatar: RecentAvatar) {
    Alerts.show({
        title: "Delete this from Discord?",
        body: <p>This removes it from Discord's archive of your past avatars, on their servers, not just from this strip. It cannot be undone.</p>,
        confirmColor: Button.Colors.RED,
        confirmText: "Delete",
        cancelText: "Cancel",
        onConfirm: async () => {
            try {
                await RestAPI.del({ url: Constants.Endpoints.RECENT_AVATARS_DELETE(avatar.id) });
                FluxDispatcher.dispatch({ type: "RECENT_AVATAR_DELETE", avatarId: avatar.id });
            } catch (err) {
                logger.error("Discord refused to delete that avatar", err);
            }
        }
    });
}

function PickerShelf({ kind, open }: { kind: Kind; open(imageUri: string, file: File): void; }) {
    const { group, setGroup, entries, thumbs, bump, track } = useLibrary(kind);
    const onForget = useForget(bump);

    const hand = useCallback((id: string | null, file: File, crop: CropState | null) => {
        handoff = { id };
        pendingCrop = crop;
        liveCrop = crop;
        open(track(URL.createObjectURL(file)), file);
    }, [open, track]);

    const onPick = useCallback(async (entry: Entry) => {
        const blob = await getFile(entry.id);
        if (!blob) return;

        hand(entry.id, new File([blob], entry.name, { type: blob.type }), settings.store.rememberCrop ? entry.crop ?? null : null);
    }, [hand]);

    const accept = useCallback(async (file: File) => {
        try {
            const id = await add(file, kind, "original", settings.store.librarySize);
            bump();
            hand(id, file, null);
        } catch (err) {
            logger.error("could not take that picture", err);
        }
    }, [kind, hand, bump]);

    const onPickRecent = useCallback(async (avatar: RecentAvatar) => {
        const user = UserStore.getCurrentUser();
        if (!user) return;

        try {
            hand(null, await toFile(recentUrl(avatar, user.id, 1024), `${avatar.storageHash}.webp`), null);
        } catch (err) {
            logger.error("could not load that avatar", err);
        }
    }, [hand]);

    usePasteAndDrop(accept, useCallback(() => editorsOpen === 0, []));

    return (
        <Shelf
            kind={kind}
            group={group}
            entries={entries}
            thumbs={thumbs}
            activeId={null}
            withRecents
            onGroup={setGroup}
            onPick={onPick}
            onForget={onForget}
            onPickRecent={onPickRecent}
            onDeleteRecent={askToDeleteRecent}
        />
    );
}

function EditorShelf({ Original, ownProps }: { Original: React.ComponentType<any>; ownProps: any; }) {
    const kind = kindOf(ownProps.uploadType);

    const { group, setGroup, entries, thumbs, bump, track } = useLibrary(kind);
    const onForget = useForget(bump);

    const [picked, setPicked] = useState<Picked | null>(null);
    const [slot, setSlot] = useState<HTMLElement | null>(null);

    const incomingId = useRef<string | null>(null);
    const pickedId = useRef<string | null>(null);
    const pickedName = useRef<string | null>(null);
    const captured = useRef(false);

    pickedId.current = picked?.id ?? null;
    pickedName.current = picked?.file.name ?? ownProps.file?.name ?? null;

    const show = useCallback((id: string, file: File, crop: CropState | null) => {
        pendingCrop = crop;
        liveCrop = crop;
        setPicked({ id, uri: track(URL.createObjectURL(file)), file });
    }, [track]);

    useEffect(() => {
        if (captured.current) return;
        captured.current = true;

        // the picker shelf already dealt with this one
        if (handoff) {
            incomingId.current = handoff.id;
            handoff = null;
            return;
        }

        if (!(ownProps.file instanceof File)) return;

        add(ownProps.file, kind, "original", settings.store.librarySize)
            .then(id => {
                incomingId.current = id;
                bump();
            })
            .catch(err => logger.error("could not save that picture", err));
    }, []);

    useEffect(() => {
        editorsOpen++;
        return () => { editorsOpen--; };
    }, []);

    // picking remounts the cropper so the crop can be seeded, which destroys the node
    // this portal hangs off. re-anchor it after every switch.
    useEffect(() => {
        const container = document.querySelector('[class*="editingContainer"]');
        if (!container?.parentElement) return;

        const el = document.createElement("div");
        container.parentElement.insertBefore(el, container.nextSibling);
        setSlot(el);

        return () => el.remove();
    }, [picked?.id]);

    const accept = useCallback(async (file: File) => {
        try {
            const id = await add(file, kind, "original", settings.store.librarySize);
            setGroup("original");
            bump();
            show(id, file, null);
        } catch (err) {
            logger.error("could not take that picture", err);
        }
    }, [kind, show, bump, setGroup]);

    usePasteAndDrop(accept, useCallback(() => true, []));

    const onPick = useCallback(async (entry: Entry) => {
        const blob = await getFile(entry.id);
        if (!blob) return;

        show(entry.id, new File([blob], entry.name, { type: blob.type }), settings.store.rememberCrop ? entry.crop ?? null : null);
    }, [show]);

    const onPickRecent = useCallback(async (avatar: RecentAvatar) => {
        const user = UserStore.getCurrentUser();
        if (!user) return;

        try {
            show(avatar.id, await toFile(recentUrl(avatar, user.id, 1024), `${avatar.storageHash}.webp`), null);
        } catch (err) {
            logger.error("could not load that avatar", err);
        }
    }, [show]);

    const keepCropped = useCallback((result: any) => {
        const uri = result?.imageUri;
        if (typeof uri !== "string") return logger.warn("the cropper returned something that cannot be saved", result);

        const save = async () => {
            const stem = (pickedName.current ?? "picture").replace(/\.[^.]+$/, "");
            await add(await toFile(uri, `${stem} (cropped)`), kind, "cropped", settings.store.librarySize);
            bump();
        };
        const run = () => save().catch(err => logger.error("could not keep the cropped copy", err));

        if (!settings.store.askBeforeSavingCropped) return void run();

        Alerts.show({
            title: "Keep the cropped copy?",
            body: <p>It goes on the {croppedLabel(kind).toLowerCase()} shelf, next to your originals.</p>,
            confirmText: "Keep",
            cancelText: "No thanks",
            onConfirm: run
        });
    }, [kind, bump]);

    const onCrop = useCallback((...args: any[]) => {
        const id = pickedId.current ?? incomingId.current;
        if (id && liveCrop && settings.store.rememberCrop) {
            saveCrop(id, cropOf(liveCrop)).catch(err => logger.error("could not remember that crop", err));
        }

        if (settings.store.saveCropped) keepCropped(args[0]);

        return ownProps.onCrop?.(...args);
    }, [ownProps.onCrop, keepCropped]);

    const props = picked
        ? { ...ownProps, imageUri: picked.uri, file: picked.file, originalAsset: null, onCrop }
        : { ...ownProps, onCrop };

    return (
        <>
            <Original key={picked?.id ?? "incoming"} {...props} />
            {slot && ReactDOM.createPortal(
                <ErrorBoundary noop>
                    <Shelf
                        kind={kind}
                        group={group}
                        entries={entries}
                        thumbs={thumbs}
                        activeId={picked?.id ?? null}
                        withRecents
                        onGroup={setGroup}
                        onPick={onPick}
                        onForget={onForget}
                        onPickRecent={onPickRecent}
                        onDeleteRecent={askToDeleteRecent}
                    />
                </ErrorBoundary>,
                slot
            )}
        </>
    );
}

let wrapped: React.ComponentType<any> | null = null;

export default definePlugin({
    name: "BetterImageEditor",
    description: "Keeps your own pictures on the image picker and under the crop window, for avatars and banners, on an uncropped shelf and a cropped one. Remembers how you framed each picture, and takes a paste or a dropped file straight in.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    patches: [
        {
            find: '"SET_IMAGE_ZOOM_RATIO"',
            replacement: [
                {
                    match: /\{default:\(\)=>(\i)\}/,
                    replace: "{default:()=>$self.wrapEditor($1)}"
                },
                {
                    match: /useReducer\((\i),(\i)\)/,
                    replace: "useReducer($self.spyCrop($1),$self.seedCrop($2))"
                }
            ]
        },
        {
            find: 'displayName="RecentAvatarsStore"',
            replacement: {
                // takes over the slot Discord renders its own recent avatars into
                match: /(uploadType:(\i),guild:\i,handleOpenImageEditingModal:(\i),[\s\S]{0,500}?)\i&&\(0,\i\.jsx\)\(\i,\{onComplete:\i,returnRef:\i\}\)/,
                replace: "$1$self.pickerRow($2,$3)"
            }
        }
    ],

    wrapEditor(Original: React.ComponentType<any>) {
        wrapped ??= (props: any) => <EditorShelf Original={Original} ownProps={props} />;
        return wrapped;
    },

    pickerRow(uploadType: string, open: (imageUri: string, file: File) => void) {
        return (
            <ErrorBoundary noop key="bie-picker">
                <PickerShelf kind={kindOf(uploadType)} open={open} />
            </ErrorBoundary>
        );
    },

    spyCrop(reducer: Function) {
        let seen = spied.get(reducer);
        if (!seen) {
            seen = (state: any, action: any) => (liveCrop = reducer(state, action));
            spied.set(reducer, seen);
        }
        return seen;
    },

    seedCrop(initial: any) {
        if (!pendingCrop) return initial;

        const crop = pendingCrop;
        pendingCrop = null;
        return { ...initial, ...crop };
    }
});
