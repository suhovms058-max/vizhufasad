"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

const MAX_BYTES = 25 * 1024 * 1024;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;
const RECOMMENDED_WIDTH = 1200;
const RECOMMENDED_HEIGHT = 800;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DRAFT_DB = "vizhufasad-browser-drafts";
const DRAFT_STORE = "files";
const DRAFT_KEY = "landing-photo-v1";

type CheckResult = {
  kind: "idle" | "success" | "warning" | "error";
  title: string;
  message: string;
};

const idleResult: CheckResult = {
  kind: "idle",
  title: "Проверим фото перед созданием варианта фасада",
  message: "Формат, размер и разрешение проверяются бесплатно. Кредит не списывается.",
};

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
        request.result.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDraft(file: File) {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).put({ file, savedAt: Date.now() }, DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function inspectImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };
    image.src = url;
  });
}

export function LandingPhotoCheck({ appUrl }: { appUrl: string }) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileDetails, setFileDetails] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CheckResult>(idleResult);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setFileDetails("");
    setResult(idleResult);
    if (galleryInput.current) galleryInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  };

  const choose = async (nextFile?: File) => {
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.has(nextFile.type)) {
      clear();
      setResult({ kind: "error", title: "Формат не поддерживается", message: "Выберите фотографию JPG, PNG или WEBP." });
      return;
    }
    if (nextFile.size > MAX_BYTES) {
      clear();
      setResult({ kind: "error", title: "Файл слишком большой", message: "Размер фотографии должен быть не больше 25 МБ." });
      return;
    }

    try {
      const dimensions = await inspectImage(nextFile);
      if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
        clear();
        setResult({
          kind: "error",
          title: "Фотография слишком маленькая",
          message: `Нужно минимум ${MIN_WIDTH}×${MIN_HEIGHT}. Выбрано ${dimensions.width}×${dimensions.height}.`,
        });
        return;
      }

      if (preview) URL.revokeObjectURL(preview);
      setFile(nextFile);
      setPreview(URL.createObjectURL(nextFile));
      setFileDetails(`${nextFile.name} · ${(nextFile.size / 1024 / 1024).toFixed(1)} МБ · ${dimensions.width}×${dimensions.height}`);
      setResult(dimensions.width < RECOMMENDED_WIDTH || dimensions.height < RECOMMENDED_HEIGHT
        ? {
            kind: "warning",
            title: "Фото подходит, но детализация ограничена",
            message: `Можно продолжить. Для более чёткой отделки лучше снимок от ${RECOMMENDED_WIDTH}×${RECOMMENDED_HEIGHT}.`,
          }
        : {
            kind: "success",
            title: "Фото подходит для следующего шага",
            message: "После входа проверим дом, освещение, перспективу и препятствия автоматически.",
          });
    } catch {
      clear();
      setResult({ kind: "error", title: "Фото не удалось открыть", message: "Файл повреждён или не является корректным изображением. Выберите другой снимок." });
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  };

  const continueToApp = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      await saveDraft(file);
      const destination = new URL(appUrl, window.location.href);
      destination.searchParams.set("from", "landing");
      window.location.assign(destination.toString());
    } catch {
      setResult({
        kind: "error",
        title: "Не удалось сохранить фото на устройстве",
        message: "Разрешите сайту локальное хранилище или продолжите в кабинете и выберите файл повторно.",
      });
      setSaving(false);
    }
  };

  return (
    <section className="photoStart section" id="photo-check" aria-labelledby="photo-check-title">
      <div className="shell photoStartGrid">
        <div className="photoStartCopy">
          <div className="eyebrow light"><span /> НАЧНИТЕ С ФОТОГРАФИИ</div>
          <h2 id="photo-check-title">Проверьте фото дома<br /><em>до выбора отделки</em></h2>
          <p>Загрузите снимок прямо здесь. Сначала бесплатно проверим технические параметры, затем в кабинете — пригодность фасада для визуализации.</p>
          <ul>
            <li>Дом виден целиком и снят при дневном свете</li>
            <li>Перед фасадом нет крупных деревьев и автомобилей</li>
            <li>JPG, PNG или WEBP до 25 МБ</li>
          </ul>
          <p className="photoPrivacy">Фото временно хранится только в вашем браузере и передаётся в приватное хранилище после входа. <a href="/legal/privacy">Как мы защищаем файлы</a></p>
        </div>

        <div className="photoCheckCard">
          <div
            className={`landingDropzone${dragging ? " dragging" : ""}${preview ? " hasPreview" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={onDrop}
          >
            {preview ? (
              <img src={preview} alt="Предпросмотр выбранной фотографии дома" />
            ) : (
              <div className="landingDropzonePrompt">
                <span aria-hidden="true">↥</span>
                <strong>Перетащите фото дома сюда</strong>
                <small>или выберите снимок с устройства</small>
              </div>
            )}
          </div>

          <input ref={galleryInput} className="visuallyHidden" type="file" aria-label="Выбрать фотографию дома" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
          <input ref={cameraInput} className="visuallyHidden" type="file" aria-label="Сделать фотографию дома" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onFile} />

          <div className="photoFileActions">
            <button className="button primary" type="button" data-analytics-event="photo_check_selected" onClick={() => galleryInput.current?.click()}>
              {preview ? "Заменить фото" : "Выбрать фото"}
            </button>
            {!preview && <button className="button photoCamera" type="button" data-analytics-event="photo_check_selected" data-analytics-placement="camera" onClick={() => cameraInput.current?.click()}>Сделать фото</button>}
            {preview && <button className="photoRemove" type="button" onClick={clear}>Удалить</button>}
          </div>

          {fileDetails && <p className="photoFileDetails">{fileDetails}</p>}
          <div className={`photoCheckResult ${result.kind}`} role="status" aria-live="polite">
            <strong>{result.title}</strong>
            <span>{result.message}</span>
          </div>
          <button className="button photoContinue" type="button" disabled={!file || saving} onClick={continueToApp}>
            {saving ? "Сохраняем фото…" : "Продолжить с этим фото →"}
          </button>
          <p className="photoNoCharge">На этом шаге оплата и кредит не требуются</p>
        </div>
      </div>
    </section>
  );
}
