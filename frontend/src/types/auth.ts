
export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;

  role: {
    id: string;
    code: string;
    name: string;
  };

  staff: {
    id: string;
    staffCode: string;
    fullName: string;
    warehouseId: string | null;
  } | null;

  permissions: string[];
}

export interface AuthSessionData {
  user: AuthUser;
  csrfToken: string;
}

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;

  permissions: {
    permission: {
      id: string;
      key: string;
      description: string | null;
    };
  }[];
}

export interface PermissionRecord {
  id: string;
  key: string;
  description: string | null;
}

export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;

  role: {
    id: string;
    code: string;
    name: string;
  };

  staff: {
    id: string;
    staffCode: string;
    fullName: string;
  } | null;
}

export interface UserOptions {
  roles: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  }[];

  staff: {
    id: string;
    staffCode: string;
    fullName: string;
  }[];
}
