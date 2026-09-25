#include <Joystick.h>

#define ThrottlePin 2
#define SteeringPin 3

int ThrottleValue;
int SteeringValue;

Joystick_ Joystick;

void setup() {
  pinMode(ThrottlePin, INPUT);
  pinMode(SteeringPin, INPUT);
  
  Joystick.begin();
  Joystick.setXAxisRange(1900, 1050);
  Joystick.setYAxisRange(1050, 1900);
}

void loop() {
  ThrottleValue = pulseIn(ThrottlePin, HIGH);
  SteeringValue = pulseIn(SteeringPin, HIGH);
  
  Joystick.setXAxis(SteeringValue);
  Joystick.setYAxis(ThrottleValue);
}