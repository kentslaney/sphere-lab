import sympy

# Define symbols
a, w, p = sympy.symbols('a w p', real=True, positive=True) # Assumption positive to handle sqrt nicely

# Define x, y, z expressions
denom_sqrt = sympy.sqrt(p**2 - a**2)
x_expr = 1 / (w * denom_sqrt)
y_expr = p**2 / (w * denom_sqrt**3)
z_expr = a / (w * denom_sqrt)

# Proposed solution: p^2 = (y * z^2) / (x^2 * (y - x))
# Let's verify the RHS
rhs = (y_expr * z_expr**2) / (x_expr**2 * (y_expr - x_expr))

# Simplify the RHS
simplified_rhs = sympy.simplify(rhs)

print(f"{simplified_rhs=}")