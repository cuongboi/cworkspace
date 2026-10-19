import { Button } from "./button"
import { Checkbox } from "./checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./field"
import { Input } from "./input"
import { Label } from "./label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { cn, type ClassNameValue } from "cn"
import { zodResolver } from "@hookform/resolvers/zod"
import merge from "deepmerge"
import { PlusIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type ControllerRenderProps,
  type FieldError as FormFieldError,
  type CustomElement,
  type FieldPath,
  type FieldValues,
  type Mode,
  type UseFormReturn,
} from "react-hook-form"
import { z, type ZodType } from "zod"

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

type AnyValue = CustomElement<NonNullable<unknown>>["value"]

type ZodTypeName = z.core.$ZodTypeDef["type"]

type ParsedField<T extends ZodType = ZodType> = {
  /** Zod type name of the unwrapped schema, e.g. "string", "array", "object". */
  type: ZodTypeName
  defaultValue?: z.output<T>
  meta?: { [key: string]: AnyValue; description?: string; title?: string }
  options?: { label: string; value: string | number }[]
}

export type FieldRenderer<T extends ZodType = ZodType> = React.ComponentType<
  ParsedField<T> & {
    id: string
    className?: string
    form: UseFormReturn<FieldValues>
    field: ControllerRenderProps<FieldValues, FieldPath<FieldValues>>
  }
>

/** Strip wrappers that don't change the shape of the value being edited. */
type UnwrapZod<T> = T extends
  | z.ZodOptional<infer I>
  | z.ZodNullable<infer I>
  | z.ZodDefault<infer I>
  | z.ZodPrefault<infer I>
  | z.ZodReadonly<infer I>
  | z.ZodNonOptional<infer I>
  | z.ZodCatch<infer I>
  ? UnwrapZod<I>
  : T extends z.ZodPipe<infer I, ZodType>
  ? UnwrapZod<I>
  : T

/**
 * Child schemas configurable via `fields`. Arrays are transparent, so for
 * `z.array(z.object({ id, name }))` the keys are `id` and `name`.
 */
type ChildShape<T> =
  UnwrapZod<T> extends z.ZodArray<infer E>
  ? ChildShape<E>
  : UnwrapZod<T> extends z.ZodObject<infer S>
  ? S
  : never

type ChildFieldConfigs<T> = [ChildShape<T>] extends [never]
  ? Record<string, FieldConfig>
  : {
    [K in keyof ChildShape<T>]?: FieldConfig<
      Extract<ChildShape<T>[K], ZodType>
    >
  }

type ArrayItem<T extends ZodType> =
  NonNullable<z.input<T>> extends readonly (infer E)[] ? E : never

export type ArrayConfig<T extends ZodType = ZodType> = {
  /** Factory for a newly appended item. Defaults to a value derived from the item schema. */
  create?: (index: number) => ArrayItem<T>
  addLabel?: React.ReactNode
  removeLabel?: string
}

/** Everything about a field except its schema; used for nested fields too. */
export type FieldConfig<T extends ZodType = ZodType> = {
  label?: string
  classNames?: {
    container?: ClassNameValue
    input?: ClassNameValue
    label?: ClassNameValue
    description?: ClassNameValue
    /** Wrapper of each row of an array field. */
    item?: ClassNameValue
  }
  placeholder?: string
  description?: string
  disabled?: boolean
  /** Keep the value in the form but don't render an input (e.g. ids). */
  hidden?: boolean
  watch?: AnyValue[]
  /** Config for child fields of an object, or of each item of an array of objects. */
  fields?: ChildFieldConfigs<T>
  /** Options for array fields. */
  array?: ArrayConfig<T>
} & Partial<Pick<ParsedField<T>, "meta" | "options">> &
  (
    | { render?: FieldRenderer<T>; as?: never }
    | { as?: React.ComponentType<AnyValue>; render?: never }
  ) & {
    [key: string]: unknown
  }

export type FieldProps<T extends ZodType = ZodType> = FieldConfig<T> & {
  schema: T
  defaultValue?: z.infer<T>
}

type Shape = Record<string, ZodType>

type FormValues<S extends Shape> = { [K in keyof S]: z.infer<S[K]> }

export type AutoFormSchema<S extends Shape> = {
  [K in keyof S]: FieldProps<S[K]>
}

type FormPanels<S extends Shape> = {
  watch: FieldPath<FormValues<S>>[]
  render: (props: { form: UseFormReturn<FormValues<S>> }) => React.ReactNode
} & ({ before: keyof S; after?: never } | { before?: never; after: keyof S })

// `S` is inferred from `schema` only; `NoInfer` stops the other props from widening it.
export type AutoFormProps<S extends Shape> = {
  schema: AutoFormSchema<S>
  mode?: Mode
  disabled?: boolean
  defaultValues?: Partial<FormValues<NoInfer<S>>>
  onSubmit: (
    data: FormValues<NoInfer<S>>,
    form: UseFormReturn<FormValues<NoInfer<S>>>
  ) => void | Promise<void>
  panels?: FormPanels<NoInfer<S>>[]
  className?: ClassNameValue
  children?: React.ReactNode
  /** Exposes the react-hook-form instance for imperative control from outside. */
  formRef?: React.Ref<UseFormReturn<FormValues<NoInfer<S>>>>
}

/* -------------------------------------------------------------------------- */
/*                               Schema helpers                               */
/* -------------------------------------------------------------------------- */

const TRANSPARENT_WRAPPERS = new Set<ZodTypeName>([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "nonoptional",
  "catch",
])

function unwrapSchema(schema: ZodType): ZodType {
  const def = schema.def
  if (TRANSPARENT_WRAPPERS.has(def.type) && "innerType" in def) {
    return unwrapSchema(def.innerType as ZodType)
  }
  if (def.type === "pipe" && "in" in def) {
    return unwrapSchema(def.in as ZodType)
  }
  return schema
}

function getObjectShape(schema: ZodType): Record<string, ZodType> {
  return (schema as z.ZodObject).def.shape as Record<string, ZodType>
}

function getArrayElement(schema: ZodType): ZodType {
  return (schema as z.ZodArray).def.element as ZodType
}

function getArrayBounds(schema: ZodType): { min: number; max: number } {
  const bounds = { min: 0, max: Infinity }
  for (const check of schema.def.checks ?? []) {
    const def = check._zod.def as {
      check: string
      minimum?: number
      maximum?: number
      length?: number
    }
    if (def.check === "min_length") bounds.min = def.minimum ?? 0
    if (def.check === "max_length") bounds.max = def.maximum ?? Infinity
    if (def.check === "length_equals") bounds.min = bounds.max = def.length ?? 0
  }
  return bounds
}

/**
 * Initial value for a schema: its declared default, or an "empty" value that
 * keeps inputs controlled and gives nested objects/arrays their structure.
 */
function getInitialValue(schema: ZodType): unknown {
  const def = schema.def
  if (def.type === "default" || def.type === "prefault") {
    return (schema as z.ZodDefault).def.defaultValue
  }
  if (TRANSPARENT_WRAPPERS.has(def.type) || def.type === "pipe") {
    // Optional/nullable values start empty instead of creating a structure.
    if (def.type === "optional" || def.type === "nullable") return undefined
    return getInitialValue(unwrapSchema(schema))
  }
  switch (def.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(getObjectShape(schema))
          .map(([key, child]) => [key, getInitialValue(child)] as const)
          .filter(([, value]) => value !== undefined)
      )
    case "array":
      return Array.from({ length: getArrayBounds(schema).min }, () =>
        getInitialValue(getArrayElement(schema))
      )
    case "boolean":
      return false
    case "string":
      return ""
    default:
      return undefined
  }
}

function prettifyLabel(label: string): string {
  return label
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/([A-Z])/g, " $1")
    .replace(/\s+/g, " ")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

function extractEnumOptions(schema: ZodType): ParsedField["options"] {
  if (schema.def.type !== "enum") return undefined
  return Object.values((schema as z.ZodEnum).def.entries).map((value) => ({
    label: prettifyLabel(String(value)),
    value,
  }))
}

function parseZodSchema(schema: ZodType): ParsedField {
  const unwrapped = unwrapSchema(schema)
  return {
    type: unwrapped.def.type,
    defaultValue: getInitialValue(schema),
    meta: schema.meta() ?? unwrapped.meta(),
    options: extractEnumOptions(unwrapped),
  }
}

/** Parent settings that cascade into child fields. */
function inheritConfig(parent: FieldConfig, child?: FieldConfig): FieldConfig {
  return { ...child, disabled: child?.disabled ?? parent.disabled }
}

/**
 * Error message of a single field, re-rendering only when that message changes.
 *
 * `fieldState` from `Controller` subscribes to the whole `errors` object, so
 * every array operation (which broadcasts `errors` for the array path) would
 * re-render every field inside it. Selecting a primitive avoids that.
 */
function useFieldErrorMessage(
  form: UseFormReturn<FieldValues>,
  name: string
): string | undefined {
  const subscribe = useCallback(
    (onChange: () => void) =>
      form.subscribe({
        name,
        exact: true,
        formState: { errors: true },
        callback: onChange,
      }),
    [form, name]
  )
  const getSnapshot = () => {
    const error = form.getFieldState(name).error as
      (FormFieldError & { root?: FormFieldError }) | undefined
    // Array-level issues (e.g. `.min(1)`) live on `root` for field arrays.
    return error?.root?.message ?? error?.message
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function toDateInputValue(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ""
  return value.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/*                                 Components                                 */
/* -------------------------------------------------------------------------- */

export const AutoPanel = <S extends Shape>({
  panel,
  form,
}: {
  panel: FormPanels<S>
  form: UseFormReturn<FormValues<S>>
}) => {
  useWatch({ name: panel.watch, control: form.control })
  return <>{panel.render({ form })}</>
}

const DefaultField: React.FC<
  Pick<ParsedField, "type" | "options"> & {
    id: string
    label: string
    field: ControllerRenderProps<FieldValues, string>
    className?: ClassNameValue
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
  }
> = ({
  type,
  options,
  id,
  label,
  field,
  className,
  placeholder,
  disabled,
  invalid,
}) => {
    const { value, onChange, onBlur, name, ref } = field
    const commonProps = {
      ref,
      name,
      onBlur,
      id,
      placeholder,
      disabled,
      "aria-invalid": invalid || undefined,
      className: cn(className),
    }

    switch (type) {
      case "number":
      case "bigint":
        return (
          <Input
            {...commonProps}
            value={value}
            type="number"
            onChange={(event) => {
              const next = event.target.value;
              if (next === "") onChange(undefined)
              else onChange(type === "bigint" ? BigInt(next) : Number(next))
            }}
          />
        )

      case "date":
        return (
          <Input
            {...commonProps}
            type="date"
            value={toDateInputValue(value)}
            onChange={(event) => onChange(event.target.valueAsDate ?? undefined)}
          />
        )

      case "file":
        // File inputs can't be controlled; only report the selection upwards.
        return (
          <Input
            {...commonProps}
            type="file"
            onChange={(event) => onChange(event.target.files?.[0])}
          />
        )

      case "boolean":
        return (
          <div className="flex items-center gap-3">
            <Checkbox
              id={id}
              ref={ref}
              checked={!!value}
              onCheckedChange={(checked) => onChange(checked === true)}
              onBlur={onBlur}
              disabled={disabled}
              aria-invalid={invalid || undefined}
            />
            <Label htmlFor={id} className="cursor-pointer">
              {placeholder || label}
            </Label>
          </div>
        )

      case "enum":
        return (
          <Select
            name={name}
            value={value == null ? "" : String(value)}
            onValueChange={(next) =>
              onChange(
                options?.find((opt) => String(opt.value) === next)?.value ?? next
              )
            }
            disabled={disabled}
          >
            <SelectTrigger
              ref={ref}
              id={id}
              onBlur={onBlur}
              aria-invalid={invalid || undefined}
              className={cn(className)}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options?.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      default:
        return (
          <Input
            {...commonProps}
            type="text"
            value={value ?? ""}
            onChange={onChange}
          />
        )
    }
  }

type NodeProps = {
  /** Full react-hook-form path, e.g. `items.0.amount`. */
  path: string
  label: string
  schema: ZodType
  parsed: ParsedField
  config: FieldConfig
  form: UseFormReturn<FieldValues>
  /** Visually hide the label (still announced to assistive tech). */
  hideLabel?: boolean
}

const AutoLeafField = ({
  path,
  label,
  parsed,
  config,
  form,
  hideLabel,
}: NodeProps) => {
  const description = config.description ?? parsed.meta?.description
  const error = useFieldErrorMessage(form, path)
  const invalid = error !== undefined

  return (
    <Controller
      control={form.control}
      name={path}
      disabled={config.disabled}
      render={({ field }) => (
        <Field
          className={cn(config.classNames?.container)}
          data-invalid={invalid}
          data-disabled={config.disabled}
        >
          {parsed.type !== "boolean" && (
            <FieldLabel
              className={cn(
                hideLabel && "sm:sr-only",
                config.classNames?.label
              )}
              htmlFor={path}
            >
              {label}
            </FieldLabel>
          )}

          {config.render ? (
            <config.render
              {...parsed}
              meta={{ ...parsed.meta, ...config.meta }}
              options={config.options ?? parsed.options}
              id={path}
              className={cn(config.classNames?.input)}
              field={field}
              form={form}
            />
          ) : config.as ? (
            <config.as
              {...field}
              {...parsed.meta}
              {...config.meta}
              id={path}
              className={cn(config.classNames?.input)}
              disabled={config.disabled}
              placeholder={config.placeholder}
            />
          ) : (
            <DefaultField
              id={path}
              label={label}
              field={field}
              type={parsed.type}
              options={config.options ?? parsed.options}
              className={config.classNames?.input}
              placeholder={config.placeholder}
              disabled={config.disabled}
              invalid={invalid}
            />
          )}

          {description && (
            <FieldDescription className={cn(config.classNames?.description)}>
              {description}
            </FieldDescription>
          )}
          {invalid && <FieldError errors={[{ message: error }]} />}
        </Field>
      )}
    />
  )
}

const AutoObjectField = ({
  path,
  label,
  schema,
  parsed,
  config,
  form,
  hideLabel,
  variant = "fieldset",
}: NodeProps & { variant?: "fieldset" | "row" }) => {
  const entries = useMemo(
    () =>
      Object.entries(getObjectShape(unwrapSchema(schema))).map(
        ([key, child]) =>
          [key, child, inheritConfig(config, config.fields?.[key])] as const
      ),
    [schema, config]
  )
  const children = entries.map(([key, child, childConfig]) => (
    <AutoField
      key={key}
      path={`${path}.${key}`}
      name={key}
      schema={child}
      config={childConfig}
      form={form}
      hideLabel={hideLabel}
    />
  ))

  // Array rows lay children out side by side, without their own legend.
  if (variant === "row") {
    return (
      <div className="grid flex-1 items-start gap-3 sm:auto-cols-fr sm:grid-flow-col">
        {children}
      </div>
    )
  }

  const description = config.description ?? parsed.meta?.description
  return (
    <FieldSet className={cn(config.classNames?.container)}>
      <FieldLegend className={cn(config.classNames?.label)}>
        {label}
      </FieldLegend>
      {description && (
        <FieldDescription className={cn(config.classNames?.description)}>
          {description}
        </FieldDescription>
      )}
      {children}
    </FieldSet>
  )
}

/**
 * The inputs of one array row. Memoized so that removing/appending a row only
 * re-renders rows whose index (and therefore path) actually changed.
 */
const AutoArrayItemFields = React.memo(function AutoArrayItemFields({
  path,
  label,
  schema,
  parsed,
  config,
  form,
  hideLabel,
}: NodeProps) {
  if (parsed.type === "object") {
    return (
      <AutoObjectField
        path={path}
        label={label}
        schema={schema}
        parsed={parsed}
        config={config}
        form={form}
        hideLabel={hideLabel}
        variant="row"
      />
    )
  }
  return (
    <div className="flex-1">
      <AutoField
        path={path}
        name={label}
        schema={schema}
        config={config}
        form={form}
        hideLabel
      />
    </div>
  )
})

const AutoArrayField = ({
  path,
  label,
  schema,
  parsed,
  config,
  form,
}: NodeProps) => {
  const { element, elementParsed, min, max } = useMemo(() => {
    const unwrapped = unwrapSchema(schema)
    const element = getArrayElement(unwrapped)
    return {
      element,
      elementParsed: parseZodSchema(element),
      ...getArrayBounds(unwrapped),
    }
  }, [schema])

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: path,
  })
  const arrayError = useFieldErrorMessage(form, path)

  // Stable identity so memoized rows don't re-render on every array change.
  const itemConfig = useMemo<FieldConfig>(
    () => ({ fields: config.fields, disabled: config.disabled }),
    [config.fields, config.disabled]
  )
  const description = config.description ?? parsed.meta?.description
  const canAdd = !config.disabled && fields.length < max
  const canRemove = !config.disabled && fields.length > min

  return (
    <FieldSet
      className={cn(config.classNames?.container)}
      data-invalid={arrayError !== undefined}
    >
      <FieldLegend className={cn(config.classNames?.label)}>
        {label}
      </FieldLegend>
      {description && (
        <FieldDescription className={cn(config.classNames?.description)}>
          {description}
        </FieldDescription>
      )}

      {fields.map((item, index) => {
        const itemPath = `${path}.${index}`
        const itemLabel = `${label} ${index + 1}`
        return (
          // `item.id` is RHF's generated key, independent of any `id` in the data.
          <div
            key={item.id}
            data-slot="array-item"
            className={cn("flex items-end gap-2", config.classNames?.item)}
          >
            <AutoArrayItemFields
              path={itemPath}
              label={itemLabel}
              schema={element}
              parsed={elementParsed}
              config={itemConfig}
              form={form}
              hideLabel={index > 0}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canRemove}
              aria-label={`${config.array?.removeLabel ?? "Xóa"} ${itemLabel}`}
              onClick={() => remove(index)}
            >
              <Trash2Icon />
            </Button>
          </div>
        )
      })}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          onClick={() =>
            append(
              (config.array?.create?.(fields.length) ??
                getInitialValue(element)) as FieldValues
            )
          }
        >
          <PlusIcon />
          {config.array?.addLabel ?? "Thêm"}
        </Button>
      </div>

      {arrayError !== undefined && (
        <FieldError errors={[{ message: arrayError }]} />
      )}
    </FieldSet>
  )
}

/** Resolves a schema to the right renderer: leaf input, object group or array. */
const AutoField = React.memo(function AutoField({
  path,
  name,
  schema,
  config,
  form,
  hideLabel,
}: {
  path: string
  /** Last path segment, used to derive the default label. */
  name: string
  schema: ZodType
  config: FieldConfig
  form: UseFormReturn<FieldValues>
  hideLabel?: boolean
}) {
  // Only subscribe when the field declares dependencies.
  useWatch({
    name: config.watch ?? [],
    control: form.control,
    disabled: !config.watch?.length,
  })

  const parsed = useMemo(() => parseZodSchema(schema), [schema])
  if (config.hidden) return null

  const props: NodeProps = {
    path,
    label: config.label ?? parsed.meta?.title ?? prettifyLabel(name),
    schema,
    parsed,
    config,
    form,
    hideLabel,
  }

  // Custom renderers always own the whole value, even for objects/arrays.
  if (config.render || config.as) return <AutoLeafField {...props} />

  switch (parsed.type) {
    case "object":
      return <AutoObjectField {...props} />
    case "array":
      return <AutoArrayField {...props} />
    default:
      return <AutoLeafField {...props} />
  }
})

export const AutoForm = React.forwardRef(
  (
    props: AutoFormProps<Shape>,
    ref: React.ForwardedRef<HTMLFormElement>
  ): React.ReactElement => {
    const {
      schema,
      className,
      onSubmit,
      defaultValues: propDefaultValues,
      children,
      panels,
      formRef,
      ...formProps
    } = props

    const { zodObject, computedDefaultValues } = useMemo(() => {
      const entries = Object.entries(schema)
      const zodObject = z.object(
        Object.fromEntries(entries.map(([key, item]) => [key, item.schema]))
      )
      const defaultsFromSchema = Object.fromEntries(
        entries.map(([key, item]) => [
          key,
          item.defaultValue ?? getInitialValue(item.schema),
        ])
      )

      return {
        zodObject,
        computedDefaultValues: merge(
          defaultsFromSchema,
          propDefaultValues ?? {},
          {
            // Provided arrays replace schema defaults instead of being concatenated.
            arrayMerge: (_target, source) => source,
          }
        ),
      }
    }, [schema, propDefaultValues])

    const form = useForm<FieldValues>({
      ...formProps,
      resolver: zodResolver(zodObject),
      defaultValues: computedDefaultValues,
    })

    React.useImperativeHandle(formRef, () => form, [form])

    return (
      <form
        onSubmit={form.handleSubmit((data) => onSubmit(data, form))}
        className={cn(className)}
        ref={ref}
      >
        {Object.entries(schema).map(
          ([key, { schema: fieldSchema, ...config }]) => {
            const beforePanel = panels?.find((p) => p.before === key)
            const afterPanel = panels?.find((p) => p.after === key)

            return (
              <React.Fragment key={key}>
                {beforePanel && <AutoPanel panel={beforePanel} form={form} />}
                <AutoField
                  path={key}
                  name={key}
                  schema={fieldSchema}
                  config={config as FieldConfig}
                  form={form}
                />
                {afterPanel && <AutoPanel panel={afterPanel} form={form} />}
              </React.Fragment>
            )
          }
        )}
        {children}
      </form>
    )
  }
) as <S extends Shape>(
  props: AutoFormProps<S> & React.RefAttributes<HTMLFormElement>
) => React.ReactElement