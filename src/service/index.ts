import { Category, PostRequest, Tag } from "@halo-dev/api-client";
import { App, Notice, requestUrl } from "obsidian";
import { HaloSite } from "../settings";
import markdownIt from "src/utils/markdown";
import { randomUUID } from "crypto";
import { readMatter } from "../utils/yaml";
import i18next from "i18next";

import { SlugGenerateService } from "../utils/slugGenerate";

class HaloService {
  private readonly site: HaloSite;
  private readonly app: App;
  private readonly headers: Record<string, string> = {};

  constructor(app: App, site: HaloSite) {
    this.app = app;
    this.site = site;

    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${site.token}`,
    };
  }

  public async generateMetadata() {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    this.app.fileManager.processFrontMatter(activeEditor.file, (frontmatter) => {
      frontmatter.title = activeEditor?.file?.basename;
      frontmatter.author = "汶泽";
      frontmatter.date = new Date().toISOString();
      frontmatter.categories = [];
      frontmatter.tags = [];
      frontmatter.cover = "";
      frontmatter.slug = "shortUUID";
      frontmatter.publish = false;
      frontmatter.halo = {
        site: this.site.url,
        name: randomUUID(),
      };
    });
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
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    let params: PostRequest = {
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

    const { content: raw } = readMatter(await this.app.vault.read(activeEditor.file));
    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    // check site url
    if (matterData?.halo?.site && matterData.halo.site !== this.site.url) {
      new Notice(i18next.t("service.error_site_not_match"));
      return;
    }

    if (matterData?.halo?.name) {
      const post = await this.getPost(matterData.halo.name);
      params = post ? post : params;
    }

    params.content.raw = raw;
    params.content.content = markdownIt.render(raw);

    // restore metadata
    if (matterData?.title) {
      params.post.spec.title = matterData.title;
    }

    if (matterData?.categories) {
      const categoryNames = await this.getCategoryNames(matterData.categories, matterData?.slug, matterData?.date);
      params.post.spec.categories = categoryNames;
    }

    if (matterData?.tags) {
      const tagNames = await this.getTagNames(matterData.tags, matterData?.slug, matterData?.date);
      params.post.spec.tags = tagNames;
    }

    // 发布时间
    params.post.spec.publishTime = matterData?.date
      ? new Date(matterData.date).toISOString()
      : new Date().toISOString();

    // 是否发布
    if (matterData?.publish === "false") {
      params.post.spec.publish = false;
    } else {
      params.post.spec.publish = true;
    }

    // 封面图
    params.post.spec.cover = matterData?.cover ? matterData.cover : "";

    try {
      if (params.post.metadata.name) {
        const { name } = params.post.metadata;

        await requestUrl({
          url: `${this.site.url}/apis/content.halo.run/v1alpha1/posts/${name}`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(params.post),
        });

        await requestUrl({
          url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/content`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(params.content),
        });
      } else {
        params.post.metadata.name = randomUUID();
        params.post.spec.title = matterData?.title || activeEditor.file.basename;
        params.post.spec.slug = SlugGenerateService.getSlug(params.post.spec.title, matterData?.slug, matterData?.date);

        const post = await requestUrl({
          url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts`,
          method: "POST",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(params),
        }).json;

        params.post = post;
      }

      // Publish post
      if (params.post.spec.publish) {
        await requestUrl({
          url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/publish`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
        });
      } else {
        await requestUrl({
          url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/unpublish`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
        });
      }

      params = (await this.getPost(params.post.metadata.name)) || params;
    } catch (error) {
      new Notice(i18next.t("service.error_publish_failed"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(params.post.spec.categories);
    const postTags = await this.getTagDisplayNames(params.post.spec.tags);

    this.app.fileManager.processFrontMatter(activeEditor.file, (frontmatter) => {
      frontmatter.title = params.post.spec.title;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: params.post.metadata.name,
        publish: params.post.spec.publish,
      };
    });

    new Notice(i18next.t("service.notice_publish_success"));
  }

  public async getCategories(): Promise<Category[]> {
    const data = await requestUrl({
      url: `${this.site.url}/apis/content.halo.run/v1alpha1/categories`,
      headers: this.headers,
    });
    return Promise.resolve(data.json.items);
  }

  public async getTags(): Promise<Tag[]> {
    const data = await requestUrl({
      url: `${this.site.url}/apis/content.halo.run/v1alpha1/tags`,
      headers: this.headers,
    });
    return Promise.resolve(data.json.items);
  }

  public async updatePost(): Promise<void> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (!matterData?.halo?.name) {
      new Notice(i18next.t("service.error_not_published"));
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    if (!post) {
      new Notice(i18next.t("service.error_post_not_found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(post.post.spec.categories);
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    await this.app.vault.modify(activeEditor.file, post.content.raw + "");

    this.app.fileManager.processFrontMatter(activeEditor.file, (frontmatter) => {
      frontmatter.title = post.post.spec.title;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: post.post.metadata.name,
        publish: post.post.spec.publish,
      };
    });
  }

  public async pullPost(name: string): Promise<void> {
    const post = await this.getPost(name);

    if (!post) {
      new Notice(i18next.t("service.error_post_not_found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(post.post.spec.categories);
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const file = await this.app.vault.create(`${post.post.spec.title}.md`, post.content.raw + "");
    this.app.workspace.getLeaf().openFile(file);

    this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.title = post.post.spec.title;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: name,
        publish: post.post.spec.publish,
      };
    });
  }

  public async getCategoryNames(displayNames: string[], slugType?: string, publishTime?: string): Promise<string[]> {
    const allCategories = await this.getCategories();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allCategories.find((item) => item.spec.displayName === name),
    );

    const promises = notExistDisplayNames.map((name, index) =>
      requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/categories`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify({
          spec: {
            displayName: name,
            slug: SlugGenerateService.getSlug(name, "title", publishTime),
            description: "",
            cover: "",
            template: "",
            priority: allCategories.length + index,
            children: [],
          },
          apiVersion: "content.halo.run/v1alpha1",
          kind: "Category",
          metadata: { name: "", generateName: "category-" },
        }),
      }),
    );

    const newCategories = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allCategories.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newCategories.map((item) => item.json.metadata.name)];
  }

  public async getCategoryDisplayNames(names?: string[]): Promise<string[]> {
    const categories = await this.getCategories();
    return names
      ?.map((name) => {
        const found = categories.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  public async getTagNames(displayNames: string[], slugType?: string, publishTime?: string): Promise<string[]> {
    const allTags = await this.getTags();

    const notExistDisplayNames = displayNames.filter((name) => !allTags.find((item) => item.spec.displayName === name));

    const promises = notExistDisplayNames.map((name) =>
      requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/tags`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify({
          spec: {
            displayName: name,
            slug: SlugGenerateService.getSlug(name, "title", publishTime),
            color: "#ffffff",
            cover: "",
          },
          apiVersion: "content.halo.run/v1alpha1",
          kind: "Tag",
          metadata: { name: "", generateName: "tag-" },
        }),
      }),
    );

    const newTags = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allTags.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newTags.map((item) => item.json.metadata.name)];
  }

  public async getTagDisplayNames(names?: string[]): Promise<string[]> {
    const tags = await this.getTags();
    return names
      ?.map((name) => {
        const found = tags.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }
}

export default HaloService;
