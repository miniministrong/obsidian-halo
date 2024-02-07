import { slugify } from "transliteration";
import ShortUniqueId from "short-unique-id";
import { isDate } from "moment";

const uid = new ShortUniqueId();

export class SlugGenerateService {
  /**
   * 生成 slug
   *
   * @param title 文章标题 {@link string}
   * @param type 生成 slug 的类型 {@link string} "title" | "shortUUID" | "UUID" | "timestamp"
   * @param date 日期 {@link string}|{@link undefined}
   * @return 返回 slug {@link string}
   */
  public static getSlug(title: string, type: string | undefined, date?: string): string {
    switch (type) {
      case "title":
        return this.slugify(title);
      case "shortUUID":
        return this.shortUUID(title);
      case "UUID":
        return this.randomUUID();
      case "timestamp":
        return this.timestamp(date);
      default:
        return this.slugify(title);
    }
  }

  /**
   * 生成随机 UUID
   *
   * @return 返回随机 UUID {@link string}
   */
  public static randomUUID(): string {
    return uid.randomUUID();
  }

  /**
   * 根据文章标题生成拼音拼接的 slug<br/>
   * 例如：文章标题为 "你好"，则生成的 slug 为 "ni-hao"
   *
   * @param title 文章标题 {@link string}
   * @return 返回拼音拼接的 slug {@link string}
   */
  public static slugify(title: string): string {
    const options = {
      trim: true,
    };
    return slugify(title, options);
  }

  /**
   * 根据文章标题生成短 id 作为 slug
   *
   * @param title 文章标题 {@link string}
   * @return 返回短 id {@link string}
   */
  public static shortUUID(title: string): string {
    if (!title) return "";
    return uid.randomUUID(8);
  }

  /**
   * 生成时间戳作为 slug
   *
   * @param date 日期 {@link string}|{@link undefined}
   */
  public static timestamp(date?: string | undefined) {
    if (!date || !isDate(date)) {
      return new Date().getTime().toString();
    }
    return new Date(date).getTime().toString();
  }
}

export default SlugGenerateService;
