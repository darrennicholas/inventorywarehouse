
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { authApi } from "@/lib/auth-api";

import { useAuth } from "@/components/auth/AuthProvider";

import type {
  UserRecord,
  UserOptions,
  RoleRecord,
  PermissionRecord,
} from "@/types/auth";

// ==========================================
// TYPES
// ==========================================

type TabType = "users" | "roles";

type UserForm = {
  fullName: string;
  email: string;
  password: string;
  roleId: string;
  staffId: string;
  isActive: boolean;
};

type RoleForm = {
  code: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
};

// ==========================================
// DEFAULT FORM VALUES
// ==========================================

const emptyUserForm: UserForm = {
  fullName: "",
  email: "",
  password: "",
  roleId: "",
  staffId: "",
  isActive: true,
};

const emptyRoleForm: RoleForm = {
  code: "",
  name: "",
  description: "",
  permissions: [],
  isActive: true,
};

// ==========================================
// CSS CLASSES
// ==========================================

const inputClass =
  "mt-1.5 w-full rounded-xl border border-slate-200 " +
  "bg-white px-3.5 py-2.5 text-sm text-slate-800 " +
  "outline-none transition focus:border-blue-500 " +
  "focus:ring-2 focus:ring-blue-100 " +
  "disabled:bg-slate-100 disabled:text-slate-400";

const primaryButton =
  "inline-flex items-center justify-center gap-2 " +
  "rounded-xl bg-blue-600 px-4 py-2.5 text-sm " +
  "font-semibold text-white transition hover:bg-blue-700 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 " +
  "rounded-xl border border-slate-200 bg-white " +
  "px-4 py-2.5 text-sm font-medium text-slate-700 " +
  "transition hover:bg-slate-50 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function AccessManagement() {
  const {
    user,
    can,
    refresh: refreshAuth,
  } = useAuth();

  // ========================================
  // ACCESS CONTROL
  // ========================================

  const canManageUsers = can("users.manage");
  const canManageRoles = can("roles.manage");

  const [selectedTab, setSelectedTab] =
    useState<TabType>("users");

  const activeTab: TabType = canManageUsers
    ? canManageRoles
      ? selectedTab
      : "users"
    : "roles";

  // ========================================
  // DATA STATES
  // ========================================

  const [users, setUsers] =
    useState<UserRecord[]>([]);

  const [roles, setRoles] =
    useState<RoleRecord[]>([]);

  const [permissions, setPermissions] =
    useState<PermissionRecord[]>([]);

  const [options, setOptions] =
    useState<UserOptions>({
      roles: [],
      staff: [],
    });

  // ========================================
  // UI STATES
  // ========================================

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");

  const [search, setSearch] =
    useState("");

  // ========================================
  // USER FORM STATES
  // ========================================

  const [showUserForm, setShowUserForm] =
    useState(false);

  const [editingUserId, setEditingUserId] =
    useState<string | null>(null);

  const [userForm, setUserForm] =
    useState<UserForm>(emptyUserForm);

  // ========================================
  // ROLE FORM STATES
  // ========================================

  const [showRoleForm, setShowRoleForm] =
    useState(false);

  const [editingRoleId, setEditingRoleId] =
    useState<string | null>(null);

  const [roleForm, setRoleForm] =
    useState<RoleForm>(emptyRoleForm);

  // ========================================
  // FETCH BACKEND DATA
  // ========================================

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [
        usersResponse,
        optionsResponse,
        rolesResponse,
        permissionsResponse,
      ] = await Promise.all([
        canManageUsers
          ? authApi<UserRecord[]>("/api/users")
          : Promise.resolve(null),

        canManageUsers
          ? authApi<UserOptions>(
              "/api/users/options"
            )
          : Promise.resolve(null),

        canManageRoles
          ? authApi<RoleRecord[]>("/api/roles")
          : Promise.resolve(null),

        canManageRoles
          ? authApi<PermissionRecord[]>(
              "/api/roles/permissions"
            )
          : Promise.resolve(null),
      ]);

      if (usersResponse) {
        setUsers(usersResponse.data);
      }

      if (optionsResponse) {
        setOptions(optionsResponse.data);
      }

      if (rolesResponse) {
        setRoles(rolesResponse.data);
      }

      if (permissionsResponse) {
        setPermissions(permissionsResponse.data);
      }

      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to load access management data"
      );
    } finally {
      setLoading(false);
    }
  }, [canManageUsers, canManageRoles]);

  // ========================================
  // INITIAL LOAD
  // ========================================

  useEffect(() => {
    if (canManageUsers || canManageRoles) {
      void Promise.resolve().then(() => loadData());
    } else {
      void Promise.resolve().then(() => setLoading(false));
    }
  }, [
    canManageUsers,
    canManageRoles,
    loadData,
  ]);

  // ========================================
  // FILTER USERS
  // ========================================

  const filteredUsers = useMemo(() => {
    const keyword = search
      .trim()
      .toLowerCase();

    if (!keyword) {
      return users;
    }

    return users.filter((item) => {
      const values = [
        item.fullName,
        item.email,
        item.role.name,
        item.role.code,
        item.staff?.fullName ?? "",
        item.staff?.staffCode ?? "",
      ];

      return values.some((value) =>
        value.toLowerCase().includes(keyword)
      );
    });
  }, [users, search]);

  // ========================================
  // FILTER ROLES
  // ========================================

  const filteredRoles = useMemo(() => {
    const keyword = search
      .trim()
      .toLowerCase();

    if (!keyword) {
      return roles;
    }

    return roles.filter((role) =>
      [
        role.name,
        role.code,
        role.description ?? "",
      ].some((value) =>
        value.toLowerCase().includes(keyword)
      )
    );
  }, [roles, search]);

  // ========================================
  // GROUP PERMISSIONS
  // ========================================

  const permissionGroups = useMemo(() => {
    const groups: Record<
      string,
      PermissionRecord[]
    > = {};

    for (const permission of permissions) {
      const groupName =
        permission.key.split(".")[0];

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push(permission);
    }

    return Object.entries(groups).sort(
      ([first], [second]) =>
        first.localeCompare(second)
    );
  }, [permissions]);

  // ========================================
  // CHANGE TAB
  // ========================================

  function changeTab(tab: TabType) {
    setSelectedTab(tab);
    setSearch("");
    setError("");
    setNotice("");
    setShowUserForm(false);
    setShowRoleForm(false);
  }

  // ========================================
  // OPEN ADD USER
  // ========================================

  function openAddUser() {
    setEditingUserId(null);

    setUserForm({
      ...emptyUserForm,
      roleId: options.roles[0]?.id ?? "",
    });

    setError("");
    setNotice("");
    setShowUserForm(true);
  }

  // ========================================
  // OPEN EDIT USER
  // ========================================

  function openEditUser(item: UserRecord) {
    setEditingUserId(item.id);

    setUserForm({
      fullName: item.fullName,
      email: item.email,
      password: "",
      roleId: item.role.id,
      staffId: item.staff?.id ?? "",
      isActive: item.isActive,
    });

    setError("");
    setNotice("");
    setShowUserForm(true);
  }

  // ========================================
  // SAVE USER
  // ========================================

  async function handleSaveUser(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canManageUsers || saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const isEditing =
        editingUserId !== null;

      const endpoint = isEditing
        ? `/api/users/${editingUserId}`
        : "/api/users";

      const method = isEditing
        ? "PATCH"
        : "POST";

      const body = {
        fullName: userForm.fullName.trim(),

        email: userForm.email
          .trim()
          .toLowerCase(),

        roleId: userForm.roleId,

        staffId: userForm.staffId || null,

        isActive: userForm.isActive,

        ...(userForm.password
          ? { password: userForm.password }
          : {}),
      };

      await authApi<UserRecord>(endpoint, {
        method,
        body: JSON.stringify(body),
      });

      setShowUserForm(false);
      setEditingUserId(null);

      await loadData();

      setNotice(
        isEditing
          ? "User updated successfully."
          : "User created successfully."
      );

      // If the current user edits their own
      // account, refresh authentication data.
      if (editingUserId === user?.id) {
        await refreshAuth();
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to save user"
      );
    } finally {
      setSaving(false);
    }
  }

  // ========================================
  // DEACTIVATE USER
  // ========================================

  async function handleDeactivateUser(
    item: UserRecord
  ) {
    if (
      !canManageUsers ||
      !item.isActive ||
      item.id === user?.id
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Deactivate account "${item.fullName}"?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await authApi<UserRecord>(
        `/api/users/${item.id}`,
        {
          method: "DELETE",
        }
      );

      await loadData();

      setNotice(
        "User deactivated successfully."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to deactivate user"
      );
    }
  }

  // ========================================
  // OPEN ADD ROLE
  // ========================================

  function openAddRole() {
    setEditingRoleId(null);

    setRoleForm({
      ...emptyRoleForm,
      permissions: [],
    });

    setError("");
    setNotice("");
    setShowRoleForm(true);
  }

  // ========================================
  // OPEN EDIT ROLE
  // ========================================

  function openEditRole(role: RoleRecord) {
    // System roles are protected.
    if (role.isSystem) {
      return;
    }

    setEditingRoleId(role.id);

    setRoleForm({
      code: role.code,
      name: role.name,
      description:
        role.description ?? "",
      isActive: role.isActive,

      permissions: role.permissions.map(
        (item) => item.permission.key
      ),
    });

    setError("");
    setNotice("");
    setShowRoleForm(true);
  }

  // ========================================
  // TOGGLE ONE PERMISSION
  // ========================================

  function togglePermission(key: string) {
    setRoleForm((previous) => {
      const selected =
        previous.permissions.includes(key);

      return {
        ...previous,

        permissions: selected
          ? previous.permissions.filter(
              (value) => value !== key
            )
          : [
              ...previous.permissions,
              key,
            ],
      };
    });
  }

  // ========================================
  // TOGGLE GROUP PERMISSIONS
  // ========================================

  function togglePermissionGroup(
    items: PermissionRecord[]
  ) {
    setRoleForm((previous) => {
      const selected =
        new Set(previous.permissions);

      const allSelected = items.every(
        (item) => selected.has(item.key)
      );

      for (const item of items) {
        if (allSelected) {
          selected.delete(item.key);
        } else {
          selected.add(item.key);
        }
      }

      return {
        ...previous,
        permissions: Array.from(selected),
      };
    });
  }

  // ========================================
  // SAVE ROLE
  // ========================================

  async function handleSaveRole(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canManageRoles || saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const isEditing =
        editingRoleId !== null;

      const endpoint = isEditing
        ? `/api/roles/${editingRoleId}`
        : "/api/roles";

      const method = isEditing
        ? "PATCH"
        : "POST";

      const body = {
        code: roleForm.code
          .trim()
          .toUpperCase(),

        name: roleForm.name.trim(),

        description:
          roleForm.description.trim() ||
          null,

        permissions: roleForm.permissions,

        isActive: roleForm.isActive,
      };

      await authApi<RoleRecord>(endpoint, {
        method,
        body: JSON.stringify(body),
      });

      setShowRoleForm(false);
      setEditingRoleId(null);

      await loadData();

      setNotice(
        isEditing
          ? "Role updated successfully."
          : "Role created successfully."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to save role"
      );
    } finally {
      setSaving(false);
    }
  }

  // ========================================
  // DEACTIVATE ROLE
  // ========================================

  async function handleDeactivateRole(
    role: RoleRecord
  ) {
    if (
      !canManageRoles ||
      role.isSystem ||
      !role.isActive
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Deactivate role "${role.name}"?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await authApi<RoleRecord>(
        `/api/roles/${role.id}`,
        {
          method: "DELETE",
        }
      );

      await loadData();

      setNotice(
        "Role deactivated successfully."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to deactivate role"
      );
    }
  }

  // ========================================
  // ACCESS DENIED
  // ========================================

  if (!canManageUsers && !canManageRoles) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-lg rounded-2xl border bg-white p-8 text-center">
          <ShieldCheck
            size={36}
            className="mx-auto text-red-500"
          />

          <h1 className="mt-4 text-xl font-bold">
            Access Denied
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Your account does not have
            permission to manage Users or Roles.
          </p>
        </div>
      </main>
    );
  }

  // ========================================
  // MAIN PAGE
  // ========================================

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ==================================
            PAGE HEADER
        ================================== */}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-blue-600 p-3.5 text-white">
              <ShieldCheck size={26} />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Access Management
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Manage users, roles and system permissions.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className={secondaryButton}
          >
            <RefreshCw
              size={16}
              className={
                loading ? "animate-spin" : ""
              }
            />

            Refresh
          </button>
        </div>

        {/* ==================================
            SUMMARY CARDS
        ================================== */}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500">
              Total Users
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {canManageUsers ? users.length : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500">
              Active Users
            </p>

            <p className="mt-2 text-3xl font-bold text-emerald-600">
              {canManageUsers
                ? users.filter(
                    (item) => item.isActive
                  ).length
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500">
              Total Roles
            </p>

            <p className="mt-2 text-3xl font-bold text-blue-600">
              {canManageRoles
                ? roles.length
                : options.roles.length || "—"}
            </p>
          </div>
        </div>

        {/* ==================================
            NOTIFICATIONS
        ================================== */}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
          >
            {notice}
          </div>
        )}

        {/* ==================================
            MAIN MANAGEMENT CARD
        ================================== */}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          {/* TAB HEADER */}

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">

            <div className="flex flex-wrap gap-2">

              {canManageUsers && (
                <button
                  type="button"
                  onClick={() =>
                    changeTab("users")
                  }
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    activeTab === "users"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Users size={17} />
                  User Management
                </button>
              )}

              {canManageRoles && (
                <button
                  type="button"
                  onClick={() =>
                    changeTab("roles")
                  }
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    activeTab === "roles"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <ShieldCheck size={17} />
                  Role Management
                </button>
              )}

            </div>

            <div className="relative w-full sm:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={
                  activeTab === "users"
                    ? "Search users..."
                    : "Search roles..."
                }
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </div>

          </div>

          {/* ==================================
              USER MANAGEMENT TAB
          ================================== */}

          {activeTab === "users" &&
            canManageUsers && (
              <div>

                {/* USER HEADER */}

                <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Registered Users
                    </h2>

                    <p className="mt-1 text-xs text-slate-500">
                      {filteredUsers.length} users found
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={openAddUser}
                    className={primaryButton}
                  >
                    <Plus size={17} />
                    Add User
                  </button>
                </div>

                {/* USER TABLE */}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">

                    <thead className="border-y border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3">
                          Full Name
                        </th>

                        <th className="px-5 py-3">
                          Email
                        </th>

                        <th className="px-5 py-3">
                          Role
                        </th>

                        <th className="px-5 py-3">
                          Staff
                        </th>

                        <th className="px-5 py-3">
                          Status
                        </th>

                        <th className="px-5 py-3 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">

                      {filteredUsers.map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50"
                        >

                          <td className="px-5 py-4 font-semibold text-slate-800">
                            {item.fullName}
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {item.email}
                          </td>

                          <td className="px-5 py-4">
                            <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              {item.role.name}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {item.staff?.fullName ?? "—"}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                item.isActive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-red-50 text-red-600"
                              }`}
                            >
                              {item.isActive
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">

                              <button
                                type="button"
                                title="Edit User"
                                aria-label={`Edit ${item.fullName}`}
                                onClick={() =>
                                  openEditUser(item)
                                }
                                className="rounded-lg bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                type="button"
                                title="Deactivate User"
                                aria-label={`Deactivate ${item.fullName}`}
                                disabled={
                                  !item.isActive ||
                                  item.id === user?.id
                                }
                                onClick={() =>
                                  void handleDeactivateUser(
                                    item
                                  )
                                }
                                className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Trash2 size={16} />
                              </button>

                            </div>
                          </td>
                        </tr>
                      ))}

                    </tbody>
                  </table>

                  {loading && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      Loading users...
                    </p>
                  )}

                  {!loading &&
                    filteredUsers.length === 0 && (
                      <p className="p-8 text-center text-sm text-slate-500">
                        No users found.
                      </p>
                    )}

                </div>
              </div>
            )}

          {/* ==================================
              ROLE MANAGEMENT TAB
          ================================== */}

          {activeTab === "roles" &&
            canManageRoles && (
              <div>

                {/* ROLE HEADER */}

                <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Roles & Permissions
                    </h2>

                    <p className="mt-1 text-xs text-slate-500">
                      {filteredRoles.length} roles found
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={openAddRole}
                    className={primaryButton}
                  >
                    <Plus size={17} />
                    Add Role
                  </button>
                </div>

                {/* ROLE TABLE */}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[740px] text-left text-sm">

                    <thead className="border-y border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3">
                          Role Name
                        </th>

                        <th className="px-5 py-3">
                          Role Code
                        </th>

                        <th className="px-5 py-3">
                          Permissions
                        </th>

                        <th className="px-5 py-3">
                          Type
                        </th>

                        <th className="px-5 py-3">
                          Status
                        </th>

                        <th className="px-5 py-3 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">

                      {filteredRoles.map((role) => (
                        <tr
                          key={role.id}
                          className="hover:bg-slate-50"
                        >

                          <td className="px-5 py-4 font-semibold">
                            {role.name}
                          </td>

                          <td className="px-5 py-4 font-mono text-xs text-slate-600">
                            {role.code}
                          </td>

                          <td className="px-5 py-4">
                            {role.permissions.length}
                          </td>

                          <td className="px-5 py-4">
                            {role.isSystem ? (
                              <span className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                                System
                              </span>
                            ) : (
                              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                Custom
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                role.isActive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-red-50 text-red-600"
                              }`}
                            >
                              {role.isActive
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">

                              <button
                                type="button"
                                title={
                                  role.isSystem
                                    ? "System role cannot be edited"
                                    : "Edit Role"
                                }
                                aria-label={`Edit ${role.name}`}
                                disabled={role.isSystem}
                                onClick={() =>
                                  openEditRole(role)
                                }
                                className="rounded-lg bg-blue-50 p-2 text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                type="button"
                                title="Deactivate Role"
                                aria-label={`Deactivate ${role.name}`}
                                disabled={
                                  role.isSystem ||
                                  !role.isActive
                                }
                                onClick={() =>
                                  void handleDeactivateRole(
                                    role
                                  )
                                }
                                className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Trash2 size={16} />
                              </button>

                            </div>
                          </td>

                        </tr>
                      ))}

                    </tbody>
                  </table>

                  {loading && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      Loading roles...
                    </p>
                  )}

                  {!loading &&
                    filteredRoles.length === 0 && (
                      <p className="p-8 text-center text-sm text-slate-500">
                        No roles found.
                      </p>
                    )}

                </div>
              </div>
            )}

        </section>
      </div>

      {/* ====================================
          ADD / EDIT USER MODAL
      ==================================== */}

      {showUserForm && canManageUsers && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4">

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-dialog-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >

            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2
                  id="user-dialog-title"
                  className="text-xl font-bold text-slate-900"
                >
                  {editingUserId
                    ? "Edit User"
                    : "Add New User"}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Configure account information and role.
                </p>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  setShowUserForm(false)
                }
                aria-label="Close"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSaveUser}
              className="space-y-4"
            >

              <div className="grid gap-4 sm:grid-cols-2">

                <label className="text-sm font-medium text-slate-700">
                  Full Name *
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={userForm.fullName}
                    onChange={(event) =>
                      setUserForm({
                        ...userForm,
                        fullName: event.target.value,
                      })
                    }
                    className={inputClass}
                    placeholder="Full name"
                  />
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Email Address *
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(event) =>
                      setUserForm({
                        ...userForm,
                        email: event.target.value,
                      })
                    }
                    className={inputClass}
                    placeholder="user@stockflow.local"
                  />
                </label>

              </div>

              <label className="block text-sm font-medium text-slate-700">
                {editingUserId
                  ? "New Password (optional)"
                  : "Password *"}

                <input
                  type="password"
                  required={!editingUserId}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={userForm.password}
                  onChange={(event) =>
                    setUserForm({
                      ...userForm,
                      password: event.target.value,
                    })
                  }
                  className={inputClass}
                  placeholder="Minimum 12 characters"
                />

                {editingUserId && (
                  <span className="mt-1 block text-xs text-slate-400">
                    Leave empty to keep the current password.
                  </span>
                )}
              </label>

              <div className="grid gap-4 sm:grid-cols-2">

                <label className="block text-sm font-medium text-slate-700">
                  Role *

                  <select
                    required
                    value={userForm.roleId}
                    disabled={
                      editingUserId === user?.id
                    }
                    onChange={(event) =>
                      setUserForm({
                        ...userForm,
                        roleId: event.target.value,
                      })
                    }
                    className={inputClass}
                  >
                    <option value="">
                      Select Role
                    </option>

                    {options.roles.map((role) => (
                      <option
                        key={role.id}
                        value={role.id}
                      >
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Staff (Optional)

                  <select
                    value={userForm.staffId}
                    onChange={(event) =>
                      setUserForm({
                        ...userForm,
                        staffId: event.target.value,
                      })
                    }
                    className={inputClass}
                  >
                    <option value="">
                      No Staff Assignment
                    </option>

                    {options.staff.map((staff) => (
                      <option
                        key={staff.id}
                        value={staff.id}
                      >
                        {staff.staffCode} — {staff.fullName}
                      </option>
                    ))}
                  </select>
                </label>

              </div>

              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={userForm.isActive}
                  disabled={
                    editingUserId === user?.id
                  }
                  onChange={(event) =>
                    setUserForm({
                      ...userForm,
                      isActive: event.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-blue-600"
                />

                Active Account
              </label>

              {!userForm.isActive && (
                <p className="text-xs text-amber-700">
                  Inactive accounts cannot log in.
                  Enable Active Account to reactivate.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">

                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setShowUserForm(false)
                  }
                  className={secondaryButton}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className={primaryButton}
                >
                  {saving
                    ? "Saving..."
                    : editingUserId
                      ? "Update User"
                      : "Create User"}
                </button>

              </div>

            </form>

          </section>
        </div>
      )}

      {/* ====================================
          ADD / EDIT ROLE MODAL
      ==================================== */}

      {showRoleForm && canManageRoles && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4">

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-dialog-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >

            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2
                  id="role-dialog-title"
                  className="text-xl font-bold text-slate-900"
                >
                  {editingRoleId
                    ? "Edit Custom Role"
                    : "Add Custom Role"}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Configure role details and permissions.
                </p>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  setShowRoleForm(false)
                }
                aria-label="Close"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSaveRole}
              className="space-y-5"
            >

              <div className="grid gap-4 sm:grid-cols-2">

                <label className="block text-sm font-medium text-slate-700">
                  Role Code *

                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={50}
                    pattern="[A-Za-z][A-Za-z0-9_]*"
                    value={roleForm.code}
                    onChange={(event) =>
                      setRoleForm({
                        ...roleForm,
                        code: event.target.value
                          .toUpperCase(),
                      })
                    }
                    className={inputClass}
                    placeholder="INVENTORY_SUPERVISOR"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Role Name *

                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    value={roleForm.name}
                    onChange={(event) =>
                      setRoleForm({
                        ...roleForm,
                        name: event.target.value,
                      })
                    }
                    className={inputClass}
                    placeholder="Inventory Supervisor"
                  />
                </label>

              </div>

              <label className="block text-sm font-medium text-slate-700">
                Description

                <textarea
                  rows={2}
                  maxLength={300}
                  value={roleForm.description}
                  onChange={(event) =>
                    setRoleForm({
                      ...roleForm,
                      description: event.target.value,
                    })
                  }
                  className={inputClass}
                  placeholder="Describe this role..."
                />
              </label>

              {/* PERMISSION SELECTION */}

              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Role Permissions
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      {roleForm.permissions.length} permissions selected
                    </p>
                  </div>
                </div>

                <div className="grid max-h-80 gap-3 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2">

                  {permissionGroups.map(
                    ([group, items]) => {
                      const allSelected =
                        items.every((item) =>
                          roleForm.permissions.includes(
                            item.key
                          )
                        );

                      return (
                        <div
                          key={group}
                          className="rounded-xl border border-slate-100 bg-slate-50 p-4"
                        >

                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h4 className="text-xs font-bold capitalize text-slate-800">
                              {group}
                            </h4>

                            <button
                              type="button"
                              onClick={() =>
                                togglePermissionGroup(
                                  items
                                )
                              }
                              className="text-xs font-semibold text-blue-600 hover:underline"
                            >
                              {allSelected
                                ? "Clear"
                                : "Select All"}
                            </button>
                          </div>

                          <div className="space-y-2">

                            {items.map(
                              (permission) => (
                                <label
                                  key={permission.id}
                                  className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={roleForm.permissions.includes(
                                      permission.key
                                    )}
                                    onChange={() =>
                                      togglePermission(
                                        permission.key
                                      )
                                    }
                                    className="h-4 w-4 accent-blue-600"
                                  />

                                  {permission.key}
                                </label>
                              )
                            )}

                          </div>
                        </div>
                      );
                    }
                  )}

                </div>
              </div>

              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={roleForm.isActive}
                  onChange={(event) =>
                    setRoleForm({
                      ...roleForm,
                      isActive: event.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-blue-600"
                />

                Active Role
              </label>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">

                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setShowRoleForm(false)
                  }
                  className={secondaryButton}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className={primaryButton}
                >
                  {saving
                    ? "Saving..."
                    : editingRoleId
                      ? "Update Role"
                      : "Create Role"}
                </button>

              </div>

            </form>

          </section>
        </div>
      )}

    </main>
  );
}
