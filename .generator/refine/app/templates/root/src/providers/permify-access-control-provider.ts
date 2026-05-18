import {
  AccessControlProvider,
  BaseKey,
  CanParams,
  CanReturnType,
} from "@refinedev/core";

export class PermifyClient {
  private instance: string;

  constructor(instance: string) {
    this.instance = instance;
  }

  async isAuthorized(
    user: string,
    resource: string,
    action: string,
    paramsId?: BaseKey | undefined,
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.instance}/v1/tenants/t1/permissions/check`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            metadata: {
              depth: 5,
            },
            entity: {
              type: resource,
              id: paramsId?.toString(),
            },
            permission: action,
            subject: {
              type: "user",
              id: user, // user ID
            },
          }),
        },
      );

      const responseData = await response.json();
      return responseData?.can === "CHECK_RESULT_ALLOWED";
    } catch (error) {
      console.error("Error while authorizing:", error);
      return false; // or handle the error as needed
    }
  }
}

// Create an instance of Permify Client
const instance = "http://localhost:3476";
const permify = new PermifyClient(instance);

//sample users data
import users from "../mock/user.json";

const role = localStorage.getItem("role") ?? "admin";
const user =
  users.find((user) => user.roles[0].guard_name === role) ?? users[0];

export const accessControlProvider: AccessControlProvider = {
  can: async ({ action, params, resource }: CanParams) => {
    // console.log(params);
    // return Promise.resolve({
    //   can: false,
    // });
    if (action) {
      //post specific access checks - show, edit and delete a post
      if (action === "show" || action === "edit" || action === "delete") {
        const result = await permify.isAuthorized(
          user.id,
          resource!,
          action,
          params?.id,
        );
        return Promise.resolve({
          can: result,
        });
      }
      //organization specific access checks - listing posts & creating posts
      const result = await permify.isAuthorized(
        user.id,
        "organization",
        action,
        user.organization_id,
      );
      return Promise.resolve({
        can: result,
      });
    }
    return Promise.resolve({
      can: true,
    });
  },
  options: {
    buttons: {
      enableAccessControl: true,
      hideIfUnauthorized: true,
    },
    queryOptions: {
      // ... default global query options
    },
  },
};
