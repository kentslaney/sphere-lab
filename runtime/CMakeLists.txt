cmake_minimum_required(VERSION 3.26)
project(sphere_runtime C CXX)
set(IREE_BUILD_COMPILER OFF CACHE BOOL "" FORCE)
set(IREE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(IREE_BUILD_SAMPLES OFF CACHE BOOL "" FORCE)
set(IREE_BUILD_BINDINGS_TFLITE OFF CACHE BOOL "" FORCE)
set(IREE_HAL_DRIVER_DEFAULTS OFF CACHE BOOL "" FORCE)
set(IREE_HAL_DRIVER_LOCAL_SYNC ON CACHE BOOL "" FORCE)
set(IREE_HAL_EXECUTABLE_LOADER_DEFAULTS OFF CACHE BOOL "" FORCE)
set(IREE_HAL_EXECUTABLE_LOADER_VMVX_MODULE ON CACHE BOOL "" FORCE)
set(IREE_HAL_EXECUTABLE_PLUGIN_DEFAULTS OFF CACHE BOOL "" FORCE)
set(IREE_ENABLE_THREADING OFF CACHE BOOL "" FORCE)
set(IREE_HOST_BIN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../.venv/bin" CACHE PATH "" FORCE)
add_subdirectory(../.build-deps/iree iree EXCLUDE_FROM_ALL)
add_executable(sphere_runtime sphere_runtime.c)
target_link_libraries(sphere_runtime PRIVATE
  iree::base iree::hal iree::hal::drivers::local_sync::sync_driver
  iree::hal::local::loaders::vmvx_module_loader iree::modules::hal
  iree::vm iree::vm::bytecode::module)
set_target_properties(sphere_runtime PROPERTIES SUFFIX ".mjs")
target_link_options(sphere_runtime PRIVATE
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createSphereRuntime"
  "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=67108864" "-sMAXIMUM_MEMORY=2147483648"
  "-sFILESYSTEM=0" "-sENVIRONMENT=web,worker,node" "-sNO_EXIT_RUNTIME=1"
  "-sEXPORTED_FUNCTIONS=['_sphere_init','_sphere_run','_sphere_close','_sphere_error','_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF32','UTF8ToString']" "--no-entry")
