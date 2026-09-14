// Browser adapter for IREE 3.11.0. No filesystem, networking, or server inference.
#include <stdio.h>
#include <string.h>
#include "iree/base/api.h"
#include "iree/hal/api.h"
#include "iree/hal/drivers/local_sync/sync_device.h"
#include "iree/hal/local/loaders/vmvx_module_loader.h"
#include "iree/modules/hal/module.h"
#include "iree/vm/api.h"
#include "iree/vm/bytecode/module.h"

static iree_vm_instance_t* instance;
static iree_hal_device_t* device;
static iree_vm_context_t* context;
static iree_vm_function_t function;
static iree_vm_function_t curvature_function;
static iree_vm_function_t centers_function;
static char error_message[2048];

static int result(iree_status_t status) {
  if (iree_status_is_ok(status)) { error_message[0] = 0; return 0; }
  iree_host_size_t n = 0;
  iree_status_format(status, sizeof(error_message), error_message, &n);
  error_message[sizeof(error_message)-1] = 0;
  int code = (int)iree_status_code(status);
  iree_status_free(status);
  return code;
}
const char* sphere_error(void) { return error_message; }
void sphere_close(void) {
  iree_vm_context_release(context); context = NULL;
  iree_hal_device_release(device); device = NULL;
  iree_vm_instance_release(instance); instance = NULL;
}
#define TRY(expr) do { status = (expr); if (!iree_status_is_ok(status)) goto cleanup; } while (0)

int sphere_init(const unsigned char* bytes, unsigned int length) {
  sphere_close();
  iree_status_t status = iree_ok_status();
  iree_allocator_t allocator = iree_allocator_system();
  iree_hal_executable_loader_t* loader = NULL;
  iree_hal_allocator_t* heap = NULL;
  iree_hal_device_group_t* group = NULL;
  iree_vm_module_t* hal = NULL;
  iree_vm_module_t* graph = NULL;
  TRY(iree_vm_instance_create(IREE_VM_TYPE_CAPACITY_DEFAULT, allocator, &instance));
  TRY(iree_hal_module_register_all_types(instance));
  TRY(iree_hal_vmvx_module_loader_create(instance, 0, NULL, allocator, &loader));
  iree_string_view_t name = iree_make_cstring_view("local-sync");
  TRY(iree_hal_allocator_create_heap(name, allocator, allocator, &heap));
  iree_hal_sync_device_params_t params;
  iree_hal_sync_device_params_initialize(&params);
  TRY(iree_hal_sync_device_create(name, &params, 1, &loader, heap, allocator, &device));
  TRY(iree_hal_device_group_create_from_device(device, allocator, &group));
  TRY(iree_hal_module_create(instance, iree_hal_module_device_policy_default(), group,
      IREE_HAL_MODULE_FLAG_SYNCHRONOUS, iree_hal_module_debug_sink_stdio(stderr), allocator, &hal));
  // JS retains bytes until sphere_close; the module borrows this allocation.
  TRY(iree_vm_bytecode_module_create(instance, IREE_VM_BYTECODE_MODULE_FLAG_NONE,
      iree_make_const_byte_span(bytes, length), iree_allocator_null(), allocator, &graph));
  iree_vm_module_t* modules[] = {hal, graph};
  TRY(iree_vm_context_create_with_modules(instance, IREE_VM_CONTEXT_FLAG_NONE, 2, modules, allocator, &context));
  TRY(iree_vm_module_lookup_function_by_name(graph, IREE_VM_FUNCTION_LINKAGE_EXPORT,
      iree_make_cstring_view("main"), &function));
  iree_vm_module_lookup_function_by_name(graph, IREE_VM_FUNCTION_LINKAGE_EXPORT,
      iree_make_cstring_view("curvature"), &curvature_function);
  iree_vm_module_lookup_function_by_name(graph, IREE_VM_FUNCTION_LINKAGE_EXPORT,
      iree_make_cstring_view("centers"), &centers_function);
cleanup:
  iree_vm_module_release(graph);
  iree_vm_module_release(hal);
  iree_hal_device_group_release(group);
  iree_hal_allocator_release(heap);
  iree_hal_executable_loader_release(loader);
  if (!iree_status_is_ok(status)) sphere_close();
  return result(status);
}

int sphere_run(const float* input, unsigned int count, float* output) {
  if (!context || count != 392 * 518) return result(iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected 392x518 depth and initialized graph"));
  iree_status_t status = iree_ok_status();
  iree_allocator_t allocator = iree_allocator_system();
  iree_hal_buffer_view_t* tensor = NULL;
  iree_vm_list_t* inputs = NULL;
  iree_vm_list_t* outputs = NULL;
  iree_vm_ref_t ref = iree_vm_ref_null();
  iree_hal_dim_t shape[] = {392, 518};
  TRY(iree_hal_buffer_view_allocate_buffer_copy(device, iree_hal_device_allocator(device),
      2, shape, IREE_HAL_ELEMENT_TYPE_FLOAT_32, IREE_HAL_ENCODING_TYPE_DENSE_ROW_MAJOR,
      (iree_hal_buffer_params_t){.type=IREE_HAL_MEMORY_TYPE_DEVICE_LOCAL, .usage=IREE_HAL_BUFFER_USAGE_DEFAULT},
      iree_make_const_byte_span(input, count * sizeof(float)), &tensor));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 1, allocator, &inputs));
  ref = iree_hal_buffer_view_move_ref(tensor); tensor = NULL;
  TRY(iree_vm_list_push_ref_move(inputs, &ref));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 1, allocator, &outputs));
  TRY(iree_vm_invoke(context, function, IREE_VM_INVOCATION_FLAG_NONE, NULL, inputs, outputs, allocator));
  iree_hal_buffer_view_t* out = iree_vm_list_get_buffer_view_assign(outputs, 0);
  if (!out || iree_hal_buffer_view_byte_length(out) != 56 * sizeof(float)) {
    status = iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected detector output [8,7]"); goto cleanup;
  }
  TRY(iree_hal_device_transfer_d2h(device, iree_hal_buffer_view_buffer(out), 0, output,
      56 * sizeof(float), IREE_HAL_TRANSFER_BUFFER_FLAG_DEFAULT, iree_infinite_timeout()));
cleanup:
  iree_vm_ref_release(&ref);
  iree_hal_buffer_view_release(tensor);
  iree_vm_list_release(inputs);
  iree_vm_list_release(outputs);
  return result(status);
}

int sphere_run_curvature(const float* input, unsigned int count, float* grad_out, float* rotated_out) {
  if (!context || count != 392 * 518) return result(iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected 392x518 depth and initialized graph"));
  iree_status_t status = iree_ok_status();
  iree_allocator_t allocator = iree_allocator_system();
  iree_hal_buffer_view_t* tensor = NULL;
  iree_vm_list_t* inputs = NULL;
  iree_vm_list_t* outputs = NULL;
  iree_vm_ref_t ref = iree_vm_ref_null();
  iree_hal_dim_t shape[] = {392, 518};
  TRY(iree_hal_buffer_view_allocate_buffer_copy(device, iree_hal_device_allocator(device),
      2, shape, IREE_HAL_ELEMENT_TYPE_FLOAT_32, IREE_HAL_ENCODING_TYPE_DENSE_ROW_MAJOR,
      (iree_hal_buffer_params_t){.type=IREE_HAL_MEMORY_TYPE_DEVICE_LOCAL, .usage=IREE_HAL_BUFFER_USAGE_DEFAULT},
      iree_make_const_byte_span(input, count * sizeof(float)), &tensor));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 1, allocator, &inputs));
  ref = iree_hal_buffer_view_move_ref(tensor); tensor = NULL;
  TRY(iree_vm_list_push_ref_move(inputs, &ref));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 2, allocator, &outputs));
  TRY(iree_vm_invoke(context, curvature_function, IREE_VM_INVOCATION_FLAG_NONE, NULL, inputs, outputs, allocator));
  iree_hal_buffer_view_t* out_grad = iree_vm_list_get_buffer_view_assign(outputs, 0);
  iree_hal_buffer_view_t* out_rotated = iree_vm_list_get_buffer_view_assign(outputs, 1);
  if (!out_grad || iree_hal_buffer_view_byte_length(out_grad) != 392 * 518 * 2 * sizeof(float)) {
    status = iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected curvature grad output [392,518,2]"); goto cleanup;
  }
  if (!out_rotated || iree_hal_buffer_view_byte_length(out_rotated) != 392 * 518 * 4 * sizeof(float)) {
    status = iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected curvature rotated output [392,518,2,2]"); goto cleanup;
  }
  if (grad_out) {
    TRY(iree_hal_device_transfer_d2h(device, iree_hal_buffer_view_buffer(out_grad), 0, grad_out,
        392 * 518 * 2 * sizeof(float), IREE_HAL_TRANSFER_BUFFER_FLAG_DEFAULT, iree_infinite_timeout()));
  }
  if (rotated_out) {
    TRY(iree_hal_device_transfer_d2h(device, iree_hal_buffer_view_buffer(out_rotated), 0, rotated_out,
        392 * 518 * 4 * sizeof(float), IREE_HAL_TRANSFER_BUFFER_FLAG_DEFAULT, iree_infinite_timeout()));
  }
cleanup:
  iree_vm_ref_release(&ref);
  iree_hal_buffer_view_release(tensor);
  iree_vm_list_release(inputs);
  iree_vm_list_release(outputs);
  return result(status);
}

int sphere_run_centers(const float* input, unsigned int count, float* centers_out) {
  if (!context || count != 392 * 518) return result(iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected 392x518 depth and initialized graph"));
  iree_status_t status = iree_ok_status();
  iree_allocator_t allocator = iree_allocator_system();
  iree_hal_buffer_view_t* tensor = NULL;
  iree_vm_list_t* inputs = NULL;
  iree_vm_list_t* outputs = NULL;
  iree_vm_ref_t ref = iree_vm_ref_null();
  iree_hal_dim_t shape[] = {392, 518};
  TRY(iree_hal_buffer_view_allocate_buffer_copy(device, iree_hal_device_allocator(device),
      2, shape, IREE_HAL_ELEMENT_TYPE_FLOAT_32, IREE_HAL_ENCODING_TYPE_DENSE_ROW_MAJOR,
      (iree_hal_buffer_params_t){.type=IREE_HAL_MEMORY_TYPE_DEVICE_LOCAL, .usage=IREE_HAL_BUFFER_USAGE_DEFAULT},
      iree_make_const_byte_span(input, count * sizeof(float)), &tensor));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 1, allocator, &inputs));
  ref = iree_hal_buffer_view_move_ref(tensor); tensor = NULL;
  TRY(iree_vm_list_push_ref_move(inputs, &ref));
  TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 1, allocator, &outputs));
  TRY(iree_vm_invoke(context, centers_function, IREE_VM_INVOCATION_FLAG_NONE, NULL, inputs, outputs, allocator));
  iree_hal_buffer_view_t* out = iree_vm_list_get_buffer_view_assign(outputs, 0);
  if (!out || iree_hal_buffer_view_byte_length(out) != 392 * 518 * 3 * sizeof(float)) {
    status = iree_make_status(IREE_STATUS_INVALID_ARGUMENT, "Expected centers output [392,518,3]"); goto cleanup;
  }
  if (centers_out) {
    TRY(iree_hal_device_transfer_d2h(device, iree_hal_buffer_view_buffer(out), 0, centers_out,
        392 * 518 * 3 * sizeof(float), IREE_HAL_TRANSFER_BUFFER_FLAG_DEFAULT, iree_infinite_timeout()));
  }
cleanup:
  iree_vm_ref_release(&ref);
  iree_hal_buffer_view_release(tensor);
  iree_vm_list_release(inputs);
  iree_vm_list_release(outputs);
  return result(status);
}
