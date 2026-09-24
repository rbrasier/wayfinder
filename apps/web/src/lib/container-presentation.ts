import {
  AcknowledgeLoginNotice,
  GetLoginNoticeStatus,
  RemoveBrandingLogo,
  SetBranding,
  SetLoginNotice,
  UploadBrandingLogo,
} from "@rbrasier/application";
import type {
  IAuditLogger,
  IAuditQueryRepository,
  IObjectStorage,
  ISystemSettingsRepository,
  LoginNoticeConfig,
} from "@rbrasier/domain";

export interface PresentationUseCaseDeps {
  systemSettings: ISystemSettingsRepository;
  objectStorage: IObjectStorage;
  auditLogger: IAuditLogger;
  auditQuery: IAuditQueryRepository;
  loadLoginNotice: () => Promise<LoginNoticeConfig>;
}

// Branding and the sign-in notice (ADR-060), factored out of the main container
// to keep container.ts under the source-size ceiling. Spread into `useCases`.
export const buildPresentationUseCases = (deps: PresentationUseCaseDeps) => ({
  setBranding: new SetBranding(deps.systemSettings, deps.auditLogger),
  uploadBrandingLogo: new UploadBrandingLogo(deps.systemSettings, deps.objectStorage, deps.auditLogger),
  removeBrandingLogo: new RemoveBrandingLogo(deps.systemSettings, deps.objectStorage, deps.auditLogger),
  setLoginNotice: new SetLoginNotice(deps.systemSettings, deps.auditLogger),
  getLoginNoticeStatus: new GetLoginNoticeStatus(deps.loadLoginNotice, deps.auditQuery),
  acknowledgeLoginNotice: new AcknowledgeLoginNotice(deps.loadLoginNotice, deps.auditLogger),
});
