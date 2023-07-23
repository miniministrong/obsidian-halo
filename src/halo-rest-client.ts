import { ListedPost, PostRequest } from "@halo-dev/api-client";
import { Notice, requestUrl } from "obsidian";
import { HaloSite } from "./settings";
import MarkdownIt from "markdown-it";
import { randomUUID } from "crypto";
import { readMatter, mergeMatter } from "./utils/yaml";

export class HaloRestClient {
  private readonly site: HaloSite;
  private readonly headers: Record<string, string> = {};

  constructor(site: HaloSite) {
    this.site = site;

    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${site.username}:${site.password}`).toString("base64")}`,
    };
  }

  public async getPost(name: string): Promise<PostRequest | undefined> {
    try {
      const post = await requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/posts/${name}`,
        headers: this.headers,
      });

      const content = await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${name}/head-content`,
        headers: this.headers,
      });

      return Promise.resolve({
        post: post.json,
        content: content.json,
      });
    } catch (error) {
      return Promise.resolve(undefined);
    }
  }

  public async publishPost(): Promise<void> {
    const { activeEditor } = app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    let requestParams: PostRequest = {
      post: {
        spec: {
          title: "",
          slug: "",
          template: "",
          cover: "",
          deleted: false,
          publish: false,
          publishTime: undefined,
          pinned: false,
          allowComment: true,
          visible: "PUBLIC",
          priority: 0,
          excerpt: {
            autoGenerate: true,
            raw: "",
          },
          categories: [],
          tags: [],
          htmlMetas: [],
        },
        apiVersion: "content.halo.run/v1alpha1",
        kind: "Post",
        metadata: {
          name: "",
          annotations: {},
        },
      },
      content: {
        raw: "",
        content: "",
        rawType: "markdown",
      },
    };

    const contentWithMatter = await app.vault.read(activeEditor.file);
    const { content: raw, data: matterData } = readMatter(contentWithMatter);

    if (matterData.halo?.name) {
      const post = await this.getPost(matterData.halo.name);
      requestParams = post ? post : requestParams;
    }

    requestParams.content.raw = raw;
    requestParams.content.content = new MarkdownIt().render(raw);

    if (requestParams.post.metadata.name) {
      await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${requestParams.post.metadata.name}/content`,
        method: "PUT",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify(requestParams.content),
      });
    } else {
      requestParams.post.metadata.name = randomUUID();
      requestParams.post.spec.title = activeEditor.file.basename;
      requestParams.post.spec.slug = randomUUID();

      const post = await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify(requestParams),
      }).json;

      requestParams.post = post;
    }

    await requestUrl({
      url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${requestParams.post.metadata.name}/publish`,
      method: "PUT",
      contentType: "application/json",
      headers: this.headers,
    }).json;

    const modifiedContent = mergeMatter(raw, {
      ...matterData,
      halo: { site: this.site.url, name: requestParams.post.metadata.name },
    });

    const editor = activeEditor.editor;
    if (editor) {
      const { left, top } = editor.getScrollInfo();
      const position = editor.getCursor();

      editor.setValue(modifiedContent);
      editor.scrollTo(left, top);
      editor.setCursor(position);
    }

    new Notice("发布成功");
  }

  public async pullPost(): Promise<void> {
    const { activeEditor } = app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const contentWithMatter = await app.vault.read(activeEditor.file);
    const { data: matterData } = readMatter(contentWithMatter);

    if (!matterData.halo?.name) {
      new Notice("此文档还未发布到 Halo");
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    const editor = activeEditor.editor;

    const modifiedContent = mergeMatter(post?.content.raw as string, {
      ...matterData,
      halo: { site: this.site.url, name: matterData.halo.name },
    });

    if (editor) {
      const { left, top } = editor.getScrollInfo();
      const position = editor.getCursor();

      editor.setValue(modifiedContent);
      editor.scrollTo(left, top);
      editor.setCursor(position);

      new Notice("更新成功");
    }
  }

  public async fetchPost(post: ListedPost): Promise<void> {
    const postWithContent = await this.getPost(post.post.metadata.name);

    const modifiedContent = mergeMatter(postWithContent?.content.raw as string, {
      halo: { site: this.site.url, name: post.post.metadata.name },
    });

    console.log(modifiedContent);

    const file = await app.vault.create(`${post.post.spec.title}.md`, modifiedContent);

    app.workspace.getLeaf().openFile(file);
  }
}
