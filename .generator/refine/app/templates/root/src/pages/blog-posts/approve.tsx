import { Textarea } from "@/components/ui/textarea";
import {
  zodResolver
} from "@hookform/resolvers/zod";
import { useForm } from "@refinedev/react-hook-form";
import {
  z
} from "zod";

import {
  CreateView,
  CreateViewHeader,
} from "@/components/refine-ui/views/create-view";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Form
} from "@/components/ui/form2";
import { useParsed } from "@refinedev/core";

const formSchema = z.object({
  aggregateId: z.union([z.string(), z.number()]).optional(),
  approveComment: z.string().nonempty("approve comment can't be null")
    .min(2, "min 2").max(10, "max 10")
});

export const BlogPostApprove = () => {
  const { id } = useParsed();

  const {
    refineCore: { onFinish },
    ...form
  } = useForm({
    resolver: zodResolver(formSchema),
    refineCoreProps: {
      resource: "blog-posts",
      action: "create",
      dataProviderName: "command",
      meta: {
        command: "approve",
      },
      redirect: false,
    },
  });

  function onSubmit(values: { approveComment: string }) {
    onFinish({
      aggregateId: id,
      ...values,
    });
  }

  return (
    <CreateView>
      <CreateViewHeader title="Approve Blog Post" />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8  py-10">
          <Field>
            <FieldLabel htmlFor="approve_comment">Approval Comment</FieldLabel>
            <Textarea
              id="approveComment"
              placeholder="Input your comment"

              {...form.register("approveComment")}
            />
            <FieldDescription>Your Approval Comment</FieldDescription>
            <FieldError>{form.formState.errors.approveComment?.message}</FieldError>
          </Field>
          <Button type="submit">Submit</Button>
        </form>
      </Form>
    </CreateView>
  );
};
