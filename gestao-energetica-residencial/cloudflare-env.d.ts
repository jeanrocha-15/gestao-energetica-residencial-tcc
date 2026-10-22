declare namespace Cloudflare {
  interface Env {
    TUYA_CLIENT_ID?: string;
    TUYA_CLIENT_SECRET?: string;
    TUYA_ENDPOINT?: string;
    TUYA_USER_ID?: string;
    TUYA_APP_UID?: string;
    LOCAL_ADMIN_USER_ID?: string;
    TUYA_OAUTH_CLIENT_ID?: string;
    TUYA_OAUTH_CLIENT_SECRET?: string;
    TUYA_OAUTH_IDENTIFIER?: string;
    TUYA_OAUTH_AUTHORIZE_URL?: string;
    TUYA_OAUTH_REDIRECT_URI?: string;
    TUYA_TOKEN_KEY?: string;
    TUYA_COLLECTOR?: DurableObjectNamespace;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
