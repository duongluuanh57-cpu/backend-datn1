/**
 * Barrel file — re-exports all auth sub-services for backward compatibility.
 */
import { AuthRegisterService } from './auth/authRegisterService.ts';
import { AuthSessionService } from './auth/authSessionService.ts';

export class AuthService {
  static register = AuthRegisterService.register;
  static login = AuthSessionService.login;
  static logout = AuthSessionService.logout;
}