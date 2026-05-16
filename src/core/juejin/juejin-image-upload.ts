import fs from 'node:fs/promises';
import path from 'node:path';

import type { Page } from 'playwright';

import { callJuejinApi } from './juejin-api';

interface ImagexTokenResponse {
  token: string;
}

interface ImageSaveResponse {
  main_url: string;
}

export async function saveRemoteImageToJuejin(page: Page, url: string): Promise<string> {
  const data = await page.evaluate(async (remoteUrl) => {
    const response = await fetch(`/image/urlSave?aid=2608&uuid=${crypto.randomUUID()}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        url: remoteUrl,
        version: '2.0',
        imgType: 'private'
      })
    });

    if (!response.ok) {
      throw new Error(`image/urlSave failed with ${response.status}`);
    }

    const json = (await response.json()) as { err_no?: number; err_msg?: string; data?: string };
    if (json.err_no && json.err_no !== 0) {
      throw new Error(json.err_msg ?? 'image/urlSave failed');
    }

    if (!json.data) {
      throw new Error('image/urlSave returned empty data');
    }

    return json.data;
  }, url);

  return data;
}

export async function uploadLocalImageToJuejin(page: Page, absolutePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(absolutePath);
  const fileName = path.basename(absolutePath);
  const mimeType = inferMimeType(fileName);
  const token = await callJuejinApi<ImagexTokenResponse>(page, '/imagex/v2/gen_token?client=web', {}, 'GET');

  const uploaded = await page.evaluate(
    async ({ bytes, name, type, stsToken }) => {
      const file = new File([new Uint8Array(bytes)], name, { type });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('token', stsToken);
      formData.append('image_scene', 'article');

      const response = await fetch('/image/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`image upload failed with ${response.status}`);
      }

      const json = (await response.json()) as {
        err_no?: number;
        err_msg?: string;
        data?: { uri?: string; url?: string; main_url?: string };
      };

      if (json.err_no && json.err_no !== 0) {
        throw new Error(json.err_msg ?? 'image upload failed');
      }

      const uri = json.data?.uri;
      const directUrl = json.data?.url ?? json.data?.main_url;

      return {
        uri,
        directUrl
      };
    },
    {
      bytes: [...fileBuffer],
      name: fileName,
      type: mimeType,
      stsToken: token.token ?? token
    }
  );

  if (uploaded.directUrl) {
    return uploaded.directUrl;
  }

  if (!uploaded.uri) {
    throw new Error('Juejin image upload returned no URL');
  }

  const resolved = await callJuejinApi<ImageSaveResponse>(
    page,
    `/imagex/v2/get_img_url?uri=${encodeURIComponent(uploaded.uri)}&img_type=private`,
    {},
    'GET'
  );

  return resolved.main_url;
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}
