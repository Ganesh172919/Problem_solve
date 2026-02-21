import * as saml2 from 'saml2-js';
import { Issuer, Strategy as OpenIDStrategy, TokenSet } from 'openid-client';
import passport from 'passport';

interface SAMLConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  privateKey?: string;
  callbackUrl: string;
}

interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope?: string;
}

interface OAuth2Config {
  authorizationURL: string;
  tokenURL: string;
  clientId: string;
  clientSecret: string;
  callbackURL: string;
  scope?: string[];
}

interface SSOUser {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, any>;
}

export class SSOProvider {
  private samlServiceProvider?: saml2.ServiceProvider;
  private oidcClient?: any;

  /**
   * Initialize SAML SSO
   */
  async initSAML(config: SAMLConfig): Promise<void> {
    const spOptions = {
      entity_id: config.issuer,
      private_key: config.privateKey || '',
      certificate: '',
      assert_endpoint: config.callbackUrl,
      force_authn: false,
      auth_context: {
        comparison: 'exact' as const,
        class_refs: ['urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'],
      },
      nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      sign_get_request: false,
      allow_unencrypted_assertion: true,
    };

    const idpOptions = {
      sso_login_url: config.entryPoint,
      sso_logout_url: config.entryPoint,
      certificates: [config.cert],
    };

    this.samlServiceProvider = new saml2.ServiceProvider(spOptions);
    const identityProvider = new saml2.IdentityProvider(idpOptions);

    console.log('SAML SSO initialized');
  }

  /**
   * Generate SAML login URL
   */
  async getSAMLLoginURL(relayState?: string): Promise<string> {
    if (!this.samlServiceProvider) {
      throw new Error('SAML not initialized');
    }

    return new Promise((resolve, reject) => {
      this.samlServiceProvider!.create_login_request_url(
        // @ts-ignore
        this.samlServiceProvider,
        { relay_state: relayState },
        (err: Error | null, loginUrl: string) => {
          if (err) reject(err);
          else resolve(loginUrl);
        }
      );
    });
  }

  /**
   * Process SAML response
   */
  async processSAMLResponse(samlResponse: string): Promise<SSOUser> {
    if (!this.samlServiceProvider) {
      throw new Error('SAML not initialized');
    }

    return new Promise((resolve, reject) => {
      this.samlServiceProvider!.post_assert(
        // @ts-ignore
        this.samlServiceProvider,
        { request_body: { SAMLResponse: samlResponse } },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
          } else {
            const user: SSOUser = {
              id: response.user.name_id,
              email: response.user.email || response.user.attributes.email?.[0],
              name: response.user.attributes.name?.[0],
              firstName: response.user.attributes.givenName?.[0],
              lastName: response.user.attributes.surname?.[0],
              attributes: response.user.attributes,
            };
            resolve(user);
          }
        }
      );
    });
  }

  /**
   * Initialize OpenID Connect (OIDC)
   */
  async initOIDC(config: OIDCConfig): Promise<void> {
    const issuer = await Issuer.discover(config.issuer);

    this.oidcClient = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri],
      response_types: ['code'],
    });

    // Set up Passport strategy
    const strategy = new OpenIDStrategy(
      {
        client: this.oidcClient,
        params: {
          scope: config.scope || 'openid email profile',
        },
      },
      (tokenSet: TokenSet, userinfo: any, done: any) => {
        return done(null, userinfo);
      }
    );

    passport.use('oidc', strategy);
    console.log('OIDC SSO initialized');
  }

  /**
   * Get OIDC authorization URL
   */
  getOIDCAuthURL(state?: string): string {
    if (!this.oidcClient) {
      throw new Error('OIDC not initialized');
    }

    return this.oidcClient.authorizationUrl({
      scope: 'openid email profile',
      state: state || this.generateState(),
    });
  }

  /**
   * Process OIDC callback
   */
  async processOIDCCallback(
    callbackParams: Record<string, string>,
    checks?: { state?: string }
  ): Promise<SSOUser> {
    if (!this.oidcClient) {
      throw new Error('OIDC not initialized');
    }

    const tokenSet = await this.oidcClient.callback(
      this.oidcClient.redirect_uris[0],
      callbackParams,
      checks
    );

    const userinfo = await this.oidcClient.userinfo(tokenSet.access_token);

    return {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
      firstName: userinfo.given_name,
      lastName: userinfo.family_name,
      attributes: userinfo,
    };
  }

  /**
   * Initialize OAuth2 (Generic)
   */
  initOAuth2(config: OAuth2Config): void {
    const OAuth2Strategy = require('passport-oauth2').Strategy;

    passport.use(
      'oauth2',
      new OAuth2Strategy(
        {
          authorizationURL: config.authorizationURL,
          tokenURL: config.tokenURL,
          clientID: config.clientId,
          clientSecret: config.clientSecret,
          callbackURL: config.callbackURL,
          scope: config.scope || ['email', 'profile'],
        },
        async (
          accessToken: string,
          refreshToken: string,
          profile: any,
          done: any
        ) => {
          try {
            // Fetch user profile from OAuth2 provider
            const user: SSOUser = {
              id: profile.id,
              email: profile.email || profile.emails?.[0]?.value,
              name: profile.displayName,
              firstName: profile.name?.givenName,
              lastName: profile.name?.familyName,
              attributes: profile,
            };
            done(null, user);
          } catch (error) {
            done(error);
          }
        }
      )
    );

    console.log('OAuth2 SSO initialized');
  }

  /**
   * Initialize Google OAuth
   */
  initGoogleOAuth(clientId: string, clientSecret: string, callbackURL: string): void {
    const GoogleStrategy = require('passport-google-oauth20').Strategy;

    passport.use(
      new GoogleStrategy(
        {
          clientID: clientId,
          clientSecret: clientSecret,
          callbackURL: callbackURL,
        },
        (accessToken: string, refreshToken: string, profile: any, done: any) => {
          const user: SSOUser = {
            id: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            attributes: profile._json,
          };
          done(null, user);
        }
      )
    );

    console.log('Google OAuth initialized');
  }

  /**
   * Initialize Microsoft Azure AD
   */
  initAzureAD(
    clientId: string,
    clientSecret: string,
    tenantId: string,
    callbackURL: string
  ): void {
    const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

    passport.use(
      new OIDCStrategy(
        {
          identityMetadata: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
          clientID: clientId,
          clientSecret: clientSecret,
          responseType: 'code',
          responseMode: 'form_post',
          redirectUrl: callbackURL,
          allowHttpForRedirectUrl: process.env.NODE_ENV === 'development',
          scope: ['profile', 'email', 'openid'],
          validateIssuer: true,
          passReqToCallback: false,
        },
        (iss: string, sub: string, profile: any, accessToken: string, refreshToken: string, done: any) => {
          const user: SSOUser = {
            id: profile.oid,
            email: profile.upn || profile.email,
            name: profile.displayName,
            firstName: profile.name?.givenName,
            lastName: profile.name?.familyName,
            attributes: profile._json,
          };
          done(null, user);
        }
      )
    );

    console.log('Azure AD initialized');
  }

  /**
   * Initialize Okta
   */
  async initOkta(
    domain: string,
    clientId: string,
    clientSecret: string,
    callbackURL: string
  ): Promise<void> {
    await this.initOIDC({
      issuer: `https://${domain}/oauth2/default`,
      clientId,
      clientSecret,
      redirectUri: callbackURL,
      scope: 'openid email profile',
    });

    console.log('Okta SSO initialized');
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Validate state parameter
   */
  validateState(receivedState: string, expectedState: string): boolean {
    return receivedState === expectedState;
  }
}

// Session serialization for Passport
passport.serializeUser((user: any, done) => {
  done(null, user);
});

passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// Singleton instance
let ssoProviderInstance: SSOProvider | null = null;

export function getSSOProvider(): SSOProvider {
  if (!ssoProviderInstance) {
    ssoProviderInstance = new SSOProvider();
  }
  return ssoProviderInstance;
}

export { passport };
